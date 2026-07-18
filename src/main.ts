import {
  AbstractInputSuggest,
  App,
  ButtonComponent,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  Hotkey,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Modifier,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  TextComponent,
  TFile,
} from "obsidian";
import { commandIds, turnTrackerCommandSpecs } from "./tools/turn-tracker/commands";
import { renderError, renderTracker } from "./tools/turn-tracker/render";
import {
  addEffect,
  advanceHours,
  clearAll,
  clearExpired,
  endTurn,
  lightSource,
  removeMarker,
  renameMarker,
  setRemaining,
  pauseMarker,
  resumeMarker,
  addNote,
  editNote,
  removeNote,
  toggleAt,
} from "./tools/turn-tracker/actions";
import { trackerCodec } from "./tools/turn-tracker/apply";
import { applyAction } from "./core/apply";
import { BlockCodec, NoteContext, RenderContext, ToolModule } from "./core/tool";
import { createChargeTrackerTool } from "./tools/charge-tracker";
import { ConfirmModal } from "./ui/confirm-modal";
import { isValidDuration, rollDuration } from "./dice";
import { BlockRange, findTrackerBlockAt, OPEN_FENCE } from "./tools/turn-tracker/block";
import { fenceTrackerBlock } from "./tools/turn-tracker/serialize";
import { seedTrackerState } from "./tools/turn-tracker/seed";
import {
  CUSTOM_TYPE,
  LEGACY_EFFECT_KEYS,
  LightPreset,
  nonEmptyString,
  TOP_LEVEL_KEYS,
  TRACKER_LANG,
  TURNS_PER_DAY,
  Transform,
  TrackerState,
  dayOf,
} from "./tools/turn-tracker/model";
import {
  calendarError,
  calendarNames,
  currentDateAsStart,
  defaultCalendarName,
  isCalendariumAvailable,
  makeFantasyDayHeader,
  setCalendariumCurrentDate,
  startDateError,
} from "./tools/turn-tracker/calendarium";
import {
  createDefaultSettings,
  DEFAULT_CALENDAR_PROPERTY,
  DEFAULT_START_PROPERTY,
  OsrTurnTrackerSettings,
} from "./tools/turn-tracker/settings";

/** The slice of Obsidian's (untyped) hotkey manager we read to show a command's assigned hotkey. */
interface HotkeyManager {
  getHotkeys?(commandId: string): Hotkey[] | undefined;
  customKeys?: Record<string, Hotkey[]>;
}

/** A modifier's symbol/word, platform-appropriate (⌘⌥⇧⌃ on macOS, words elsewhere). */
const modifierLabel = (modifier: Modifier): string => {
  const mac = Platform.isMacOS;
  switch (modifier) {
    case "Mod":
      return mac ? "⌘" : "Ctrl";
    case "Meta":
      return mac ? "⌘" : "Win";
    case "Ctrl":
      return mac ? "⌃" : "Ctrl";
    case "Alt":
      return mac ? "⌥" : "Alt";
    case "Shift":
      return mac ? "⇧" : "Shift";
  }
};

/** Render a hotkey the way Obsidian's own UI does: glued symbols on macOS (⌘⇧E), `+`-joined elsewhere. */
function formatHotkey(hotkey: Hotkey): string {
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  const parts = [...(hotkey.modifiers ?? []).map(modifierLabel), key];
  return Platform.isMacOS ? parts.join("") : parts.join("+");
}

/** An editor command a tool contributes. `id` is already tool-namespaced; the host registers it. */
interface ToolCommand {
  id: string;
  name: string;
  editorCallback: (editor: Editor) => void;
}

/**
 * A tool as the plugin host sees it: the portable `ToolModule` plus the Obsidian-integration hooks
 * (editor commands). These live here, not in `core/`, so `core/` stays free of Obsidian types.
 */
interface PluginTool<S> extends ToolModule<S> {
  commands?(): ToolCommand[];
}

export default class OsrTurnTrackerPlugin extends Plugin {
  settings: OsrTurnTrackerSettings = createDefaultSettings();

  /** Serializes writes so rapid clicks can't race on a stale block snapshot. */
  private applying = false;

  /** Notify at most once per session when a block's calendar can't be resolved. */
  private calendarWarned = false;

  /** Per custom-effect-label usage: total count and a tally of the durations it was used with. */
  private effectHistory: Record<string, EffectStat> = {};

  async onload() {
    // Validate each field against malformed/stale persisted data rather than trusting the shape.
    const loaded = (await this.loadData()) ?? {};
    const defaults = createDefaultSettings();
    this.settings = {
      presets: Array.isArray(loaded.presets)
        ? loaded.presets.map((p: LightPreset) => ({ ...p, turns: String(p.turns) })) // migrate legacy numeric durations
        : defaults.presets,
      advanceShortcuts: Array.isArray(loaded.advanceShortcuts)
        ? [...loaded.advanceShortcuts]
        : defaults.advanceShortcuts,
      lookaheadBuffer:
        typeof loaded.lookaheadBuffer === "number" ? loaded.lookaheadBuffer : defaults.lookaheadBuffer,
      syncCalendariumDate:
        typeof loaded.syncCalendariumDate === "boolean"
          ? loaded.syncCalendariumDate
          : defaults.syncCalendariumDate,
      calendarProperty: nonEmptyString(loaded.calendarProperty) ?? defaults.calendarProperty,
      startProperty: nonEmptyString(loaded.startProperty) ?? defaults.startProperty,
    };
    this.effectHistory = normalizeEffectHistory(loaded.effectHistory);
    this.addSettingTab(new OsrSettingsTab(this.app, this));

    // Each tool renders its own code block through the shared host. Processors registered on the
    // plugin are auto-detached on unload.
    this.registerTool(this.createTurnTrackerTool());
    this.registerTool(createChargeTrackerTool(this.app));

    this.registerEditorSuggest(new TrackerSuggest(this.app, this));
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, effectHistory: this.effectHistory });
  }

  /** Custom effect labels, most-used first (alphabetical within equal counts). */
  private frequentEffectLabels(): string[] {
    return Object.keys(this.effectHistory).sort(
      (a, b) => this.effectHistory[b].count - this.effectHistory[a].count || a.localeCompare(b),
    );
  }

  /**
   * The duration expression to pre-fill for a label, when it's unambiguous — the single one it's
   * always been used with, or a strict most-common one. May be dice (e.g. "2d6+1"), which re-rolls
   * on submit. Returns undefined when there's no clear winner.
   */
  private durationFor(label: string): string | undefined {
    const durations = this.effectHistory[label]?.durations;
    if (!durations) return undefined;
    const ranked = Object.entries(durations).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return undefined;
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined; // tie → not clear
    return ranked[0][0];
  }

  /** Bump a label's usage so it surfaces higher in suggestions and learns its typical duration. */
  private recordEffect(label: string, duration: string): void {
    const stat = this.effectHistory[label] ?? { count: 0, durations: {} };
    stat.count += 1;
    stat.durations[duration] = (stat.durations[duration] ?? 0) + 1;
    this.effectHistory[label] = stat;
    void this.saveSettings();
  }

  /** Recorded custom-effect labels with their usage (most-used first), for the settings view. */
  effectHistoryView(): { label: string; count: number; durations: [string, number][] }[] {
    return this.frequentEffectLabels().map((label) => ({
      label,
      count: this.effectHistory[label].count,
      durations: Object.entries(this.effectHistory[label].durations),
    }));
  }

  /** Forget a recorded custom-effect label so it no longer suggests or pre-fills a duration. */
  async forgetEffect(label: string): Promise<void> {
    delete this.effectHistory[label];
    await this.saveSettings();
  }

  /** Forget every recorded custom-effect label. */
  async forgetAllEffects(): Promise<void> {
    this.effectHistory = {};
    await this.saveSettings();
  }

  /** Register a tool with the host: its code-block processor (parse via codec → resolve/validate →
   *  render with a `mutate` bridge onto the shared write funnel) and its editor commands. */
  private registerTool<S>(tool: PluginTool<S>): void {
    for (const command of tool.commands?.() ?? []) {
      this.addCommand(command);
    }
    this.registerMarkdownCodeBlockProcessor(tool.lang, (source, el, ctx) => {
      const parsed = tool.codec.parse(source);
      if (!parsed.ok) {
        renderError(el, parsed.error);
        return;
      }
      let state = parsed.state;
      if (tool.prepare) {
        const note: NoteContext = { frontmatter: this.frontmatterAt(ctx.sourcePath) };
        const prepared = tool.prepare(state, note, (t) =>
          this.backfillTransform(el, ctx, tool.codec, t),
        );
        if ("error" in prepared) {
          renderError(el, prepared.error);
          return;
        }
        state = prepared.state;
      }
      // Own any markdown render-children on a child scoped to this block, so they unload when the
      // block re-renders. Passing the plugin as owner would leak them until the plugin unloads.
      const renderChild = new MarkdownRenderChild(el);
      ctx.addChild(renderChild);
      tool.render({
        container: el,
        state,
        sourcePath: ctx.sourcePath,
        mutate: (transform) =>
          this.persistWidgetMutation(el, ctx, tool.codec, transform, tool.afterWrite),
        renderMarkdown: (host, text) =>
          void MarkdownRenderer.render(this.app, text, host, ctx.sourcePath, renderChild),
        hotkeyLabel: (commandId) => this.hotkeyLabel(commandId),
      });
    });
  }

  /** The turn tracker as a self-contained tool: codec, frontmatter resolution, widget, and commands. */
  private createTurnTrackerTool(): PluginTool<TrackerState> {
    return {
      id: TRACKER_LANG,
      lang: TRACKER_LANG,
      displayName: "Turn tracker",
      codec: trackerCodec,
      afterWrite: this.syncCalendarDay,
      commands: () => this.turnTrackerCommands(),
      prepare: (state, note, backfill) => {
        // Resolve the effective calendar/start: the block's own values (authoritative once written),
        // then note frontmatter (fills a block that still lacks its own value, so a corrected
        // frontmatter reloads it), then Calendarium's default calendar / current date.
        const resolved = this.resolveState(state, note.frontmatter);
        // A typo'd calendar name or an unparseable start fails loudly rather than silently defaulting.
        const calErr =
          calendarError(resolved.calendar) ?? startDateError(resolved.calendar, resolved.start);
        if (calErr) return { error: calErr };
        // Anchor a block missing calendar/start by persisting the resolved values (the host skips the
        // write while the file is open in an editor, to avoid racing its buffer).
        if ((resolved.calendar && !state.calendar) || (resolved.start && !state.start)) {
          backfill((s) => this.fillMissing(s, resolved, false));
        }
        return { state: { ...state, calendar: resolved.calendar, start: resolved.start } };
      },
      render: (ctx) => this.renderTrackerWidget(ctx),
    };
  }

  /** The turn tracker's editor commands: each spec (from the shared builder) paired with the editor
   *  action for its id. Dynamic commands (advance shortcuts, light presets) are read from settings at
   *  load; changing the lists takes effect on reload. */
  private turnTrackerCommands(): ToolCommand[] {
    const run = (transform: Transform) => (editor: Editor) =>
      void this.mutateFromEditor(editor, transform);
    const actions: Record<string, (editor: Editor) => void> = {
      [commandIds.endTurn]: run(endTurn),
      [commandIds.clearExpired]: run(clearExpired),
      [commandIds.clearAll]: run(clearAll),
      [commandIds.addNote]: (editor) =>
        this.openNoteModal(undefined, (t) => void this.mutateFromEditor(editor, t)),
      [commandIds.addEffect]: (editor) =>
        this.openEffectModal(undefined, (t) => void this.mutateFromEditor(editor, t)),
      [commandIds.insert]: (editor) => this.insertTracker(editor),
      ...Object.fromEntries(
        this.settings.advanceShortcuts.map((h) => [commandIds.advance(h), run(advanceHours(h))]),
      ),
      ...Object.fromEntries(
        this.settings.presets.map((preset) => [
          commandIds.light(preset.id),
          (editor: Editor) => {
            const transform = this.lightTransform(preset.id);
            if (transform) void this.mutateFromEditor(editor, transform);
          },
        ]),
      ),
    };
    return turnTrackerCommandSpecs(this.settings.advanceShortcuts, this.settings.presets).map(
      (spec) => {
        const editorCallback = actions[spec.id];
        if (!editorCallback) throw new Error(`Turn tracker command "${spec.id}" has no action.`);
        return { id: spec.id, name: spec.name, editorCallback };
      },
    );
  }

  /** Insert a fresh, self-contained tracker block at the cursor, pre-filled from note frontmatter. */
  private insertTracker(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    const frontmatter = file ? this.frontmatterAt(file.path) : undefined;
    // Pre-fill valid calendar/start here (a safe editor write) so the block is self-contained; an
    // invalid frontmatter value is left out and surfaces as an error on render.
    const base: TrackerState = { position: 0, markers: [] };
    const state = this.fillMissing(base, this.resolveState(base, frontmatter), true);
    editor.replaceSelection(`${fenceTrackerBlock(state)}\n`);
  }

  /** Build the tracker widget's handlers from the generic `mutate` bridge and render it. */
  private renderTrackerWidget(ctx: RenderContext<TrackerState>): void {
    // Fill the block's missing calendar/start (from live frontmatter) on each user action, so the
    // first write anchors them. Reads frontmatter fresh at click time, not at render time.
    const mutate = (transform: Transform): void =>
      ctx.mutate(this.withResolvedDefaults(transform, this.frontmatterAt(ctx.sourcePath)));
    renderTracker(
      ctx.container,
      ctx.state,
      this.settings,
      {
        onEndTurn: () => mutate(endTurn),
        onAdvanceHours: (hours) => mutate(advanceHours(hours)),
        onBoxClick: (turn) => mutate(toggleAt(turn)),
        onLight: (presetId, startsAt) => {
          const transform = this.lightTransform(presetId, startsAt);
          if (transform) mutate(transform);
        },
        onAddEffect: (startsAt) => this.openEffectModal(startsAt, mutate),
        onClearExpired: () => mutate(clearExpired),
        onClearAll: () => mutate(clearAll),
        onRemoveMarker: (index, label) =>
          new ConfirmModal(this.app, `Remove "${label}"?`, () => mutate(removeMarker(index))).open(),
        onRenameMarker: (index, name) => mutate(renameMarker(index, name)),
        onPause: (index) => mutate(pauseMarker(index)),
        onResume: (index) => mutate(resumeMarker(index)),
        onSetRemaining: (index, turns) => mutate(setRemaining(index, turns)),
        onCopyState: () => void this.copyState(ctx.state),
        onAddNote: (at) => this.openNoteModal(at, mutate),
        onEditNote: (index, text) =>
          new NoteModal(this.app, text, (next) => mutate(editNote(index, next))).open(),
        onDeleteNote: (index) =>
          new ConfirmModal(this.app, "Delete this note?", () => mutate(removeNote(index))).open(),
        hotkey: (commandId) => ctx.hotkeyLabel(commandId),
      },
      makeFantasyDayHeader(ctx.state, () => this.warnCalendar()),
      ctx.renderMarkdown,
    );
  }

  /** Locate the file + block range for a rendered widget. `info.text`/line numbers are a consistent
   *  snapshot from getSectionInfo; undefined when the block can't be resolved (e.g. transient render). */
  private locateBlock(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): { file: TFile; text: string; range: BlockRange } | undefined {
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !(file instanceof TFile)) return undefined;
    return { file, text: info.text, range: { lineStart: info.lineStart, lineEnd: info.lineEnd } };
  }

  /** The note's frontmatter (or undefined), by path — the single accessor frontmatter reads funnel
   *  through, so every block reads its note context one consistent way. */
  private frontmatterAt(path: string): Record<string, unknown> | undefined {
    return this.app.metadataCache.getCache(path)?.frontmatter;
  }

  /** Roll a preset's duration and build the transform that lights it, or return undefined (after a
   *  notice) when the duration is invalid. Shared by the widget button and the light hotkey command. */
  private lightTransform(presetId: string, startsAt?: number): Transform | undefined {
    const preset = this.settings.presets.find((p) => p.id === presetId);
    if (!preset) return undefined;
    // Roll the preset's duration expression now, so the marker gets a fixed span.
    const roll = rollDuration(preset.turns);
    if (!roll || roll.total < 1) {
      new Notice(`"${preset.label}" has an invalid duration (${preset.turns}).`);
      return undefined;
    }
    if (roll.rolled) new Notice(`${preset.label} — rolled ${roll.expr}: ${roll.total} turn(s).`);
    return lightSource(presetId, roll.total, startsAt);
  }

  /** Open the "add note" modal, committing the resulting transform via `commit` (from the widget or
   *  the editor command). `at` is the anchored turn, or undefined for the current turn. */
  private openNoteModal(at: number | undefined, commit: (transform: Transform) => void): void {
    new NoteModal(this.app, "", (text) => commit(addNote(text, at))).open();
  }

  /** Open the "add effect" modal, committing the resulting transform via `commit` and recording the
   *  effect for autocomplete. Shared by the widget button and the effect hotkey command. */
  private openEffectModal(startsAt: number | undefined, commit: (transform: Transform) => void): void {
    new EffectModal(
      this.app,
      { labels: this.frequentEffectLabels(), durationFor: (l) => this.durationFor(l) },
      (label, turns, duration) => {
        commit(addEffect(label, turns, startsAt));
        this.recordEffect(label, duration);
      },
    ).open();
  }

  /** The formatted hotkey a user has assigned to `commandId` (relative to this plugin), or undefined
   *  when none is set — shown quietly on the matching widget button. Reads Obsidian's (untyped) hotkey
   *  manager defensively, so a future API change just hides the hint rather than breaking rendering. */
  private hotkeyLabel(commandId: string): string | undefined {
    const manager = (this.app as unknown as { hotkeyManager?: HotkeyManager }).hotkeyManager;
    const fullId = `${this.manifest.id}:${commandId}`;
    const hotkeys = manager?.getHotkeys?.(fullId) ?? manager?.customKeys?.[fullId];
    return hotkeys?.length ? formatHotkey(hotkeys[0]) : undefined;
  }

  /** Widget write path: locate the clicked block via getSectionInfo, then persist through the funnel
   *  with the tool's codec and post-write hook. The `mutate` bridge handed to a tool's render. */
  private persistWidgetMutation<S>(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    codec: BlockCodec<S>,
    transform: (state: S) => S,
    afterWrite?: (before: S, after: S) => void,
  ): void {
    const located = this.locateBlock(el, ctx);
    if (!located) {
      new Notice("Could not locate the block.");
      return;
    }
    void this.applyToFile(located.file, located.text, located.range, codec, transform, afterWrite);
  }

  /** The effective calendar/start for a block, in precedence order: the block's own values, then the
   *  note's frontmatter, then Calendarium's default calendar / current date. The block wins, so once a
   *  valid value is serialized it's authoritative; a value only comes from frontmatter while the block
   *  still lacks its own (which is how a corrected frontmatter reloads a block whose invalid value was
   *  never written). */
  private resolveState(
    state: TrackerState,
    frontmatter: Record<string, unknown> | undefined,
  ): { calendar?: string; start?: string } {
    const seeded = seedTrackerState(frontmatter, {
      calendarProperty: this.settings.calendarProperty,
      startProperty: this.settings.startProperty,
    });
    const calendar = state.calendar ?? seeded.calendar ?? defaultCalendarName();
    const start = state.start ?? seeded.start ?? (calendar ? currentDateAsStart(calendar) : undefined);
    return { calendar, start };
  }

  /** Return `state` with any missing calendar/start filled from `resolved` (never overwriting the
   *  block's own values). When `validate`, an invalid resolved value is skipped so it's never
   *  serialized — the block stays gap-filled from frontmatter each render until it's corrected. */
  private fillMissing(
    state: TrackerState,
    resolved: { calendar?: string; start?: string },
    validate: boolean,
  ): TrackerState {
    const calOk =
      resolved.calendar && !state.calendar && (!validate || !calendarError(resolved.calendar));
    const startOk =
      resolved.start &&
      !state.start &&
      (!validate || !startDateError(resolved.calendar, resolved.start));
    return {
      ...state,
      ...(calOk ? { calendar: resolved.calendar } : {}),
      ...(startOk ? { start: resolved.start } : {}),
    };
  }

  /** Whether `path` is open in a source/live-preview editor, where writing to disk would race an
   *  unsaved buffer and duplicate content. Reading-only views are safe to persist under. */
  private isFileBeingEdited(path: string): boolean {
    return this.app.workspace.getLeavesOfType("markdown").some((leaf) => {
      const view = leaf.view;
      return view instanceof MarkdownView && view.file?.path === path && view.getMode() === "source";
    });
  }

  /** Persist a seed transform into a block that's missing values — but never while the file is open in
   *  an editor (writing then races the unsaved buffer). Quiet: retries next render if the block can't
   *  be located this pass. Handed to a tool's `prepare` as its `backfill`. */
  private backfillTransform<S>(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    codec: BlockCodec<S>,
    transform: (state: S) => S,
  ): void {
    if (this.isFileBeingEdited(ctx.sourcePath)) return;
    const located = this.locateBlock(el, ctx);
    if (!located) return;
    void this.applyToFile(located.file, located.text, located.range, codec, transform);
  }

  /** Wrap a transform so it first fills the block's missing calendar/start with resolved, *valid*
   *  values. This persists them on the user's action (a safe write) rather than during render, and
   *  never serializes an invalid value — the block stays gap-filled from frontmatter each render
   *  until it's corrected. */
  private withResolvedDefaults(
    transform: Transform,
    frontmatter: Record<string, unknown> | undefined,
  ): Transform {
    return (s) => transform(this.fillMissing(s, this.resolveState(s, frontmatter), true));
  }

  /** Write path for the command: block located relative to the editor cursor. */
  private async mutateFromEditor(editor: Editor, transform: Transform): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const text = editor.getValue();
    const range = findTrackerBlockAt(text, editor.getCursor().line);
    if (!range) {
      new Notice("Place the cursor in a turn-tracker block.");
      return;
    }
    const frontmatter = this.frontmatterAt(file.path);
    await this.applyToFile(
      file,
      text,
      range,
      trackerCodec,
      this.withResolvedDefaults(transform, frontmatter),
      this.syncCalendarDay,
    );
  }

  /** Tool-neutral write funnel: apply a transform to a block via its codec, write once, then run the
   *  tool's post-write hook. Serialized by `applying` so rapid clicks can't race on a stale snapshot. */
  private async applyToFile<S>(
    file: TFile,
    sourceText: string,
    range: BlockRange,
    codec: BlockCodec<S>,
    transform: (state: S) => S,
    afterWrite?: (before: S, after: S) => void,
  ): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      const result = applyAction(sourceText, range, codec, transform);
      if (!result.ok) {
        new Notice(result.error);
        return;
      }
      await this.app.vault.modify(file, result.newText);
      afterWrite?.(result.before, result.after);
    } finally {
      this.applying = false;
    }
  }

  /** Turn-tracker post-write side effect: push the new in-game day into Calendarium when an action
   *  crossed a day boundary. Passed to the write funnel so the funnel itself stays tool-neutral. */
  private syncCalendarDay = (before: TrackerState, after: TrackerState): void => {
    if (this.settings.syncCalendariumDate && dayOf(after.position) !== dayOf(before.position)) {
      setCalendariumCurrentDate(after);
    }
  };

  private warnCalendar(): void {
    if (this.calendarWarned) return;
    this.calendarWarned = true;
    new Notice("OSR Turn Tracker: couldn't read the Calendarium calendar — using default dates.");
  }

  /** Copy the tracker as a `turn-tracker` code block, ready to paste into another note. */
  private async copyState(state: TrackerState): Promise<void> {
    // Stamp the render origin at the current day's start so a pasted clone doesn't replay prior days,
    // and drop spent markers so the clone starts clean.
    const origin = dayOf(state.position) * TURNS_PER_DAY;
    const pruned = clearExpired(state);
    // Keep only notes at or after the current turn (past notes belong to the finished session).
    const notes = pruned.notes?.filter((n) => n.at >= state.position);
    try {
      await navigator.clipboard.writeText(fenceTrackerBlock({ ...pruned, origin, notes }));
      new Notice("Tracker state copied to clipboard.");
    } catch {
      new Notice("OSR Turn Tracker: couldn't access the clipboard.");
    }
  }
}

type TrackerSuggestion = { display: string; hint: string; insert: string };
type Section = "top" | "effects" | "notes";
type ListSection = Exclude<Section, "top">;

/** Per-list-section data: the entry keys, the value that starts an entry, and the "new entry" label. */
const SECTION_ENTRIES: Record<ListSection, { keys: string[]; scaffold: string; newLabel: string }> = {
  effects: {
    keys: ["type", "label", "startsAt", "duration", "pauses"],
    scaffold: "type: ",
    newLabel: "- type: … (new effect)",
  },
  notes: { keys: ["at", "text"], scaffold: "at: ", newLabel: "- at: … (new note)" },
};

const EFFECT_SECTION_KEYS = new Set<string>(["effects", ...LEGACY_EFFECT_KEYS]);

/** The section a column-0 `key:` opens. */
function sectionFor(key: string): Section {
  if (EFFECT_SECTION_KEYS.has(key)) return "effects";
  if (key === "notes") return "notes";
  return "top";
}

const FENCE_LINE = /^`{3,}/;
const TYPE_VALUE_RE = /^\s*(?:-\s*)?type:\s*(\S*)$/;
// The `calendar:` value can contain spaces (e.g. "Calendar of Greyhawk"), so capture the whole rest.
const CALENDAR_VALUE_RE = /^calendar:\s*(.*)$/;
// An optional indent, an optional list dash, a partial word. A line with a colon never matches, so a
// completed `key:` doesn't re-trigger (and neither does mid-sentence prose).
const STRUCTURE_RE = /^(\s*)(-\s*)?([A-Za-z]*)$/;

/**
 * Autocomplete while hand-editing a `turn-tracker` fence — the one place the interactive widget
 * isn't shown. It is section-aware: top-level keys at column 0, a `- type:`/`- at:` scaffold and
 * entry keys inside `effects:`/`notes:`, the preset ids (plus `custom`) on a `type:` value, and the
 * installed Calendarium calendars on a `calendar:` value.
 */
class TrackerSuggest extends EditorSuggest<TrackerSuggestion> {
  // Context captured in onTrigger, consumed in getSuggestions.
  private mode: "type" | "calendar" | "structure" = "structure";
  private section: Section = "top";
  private indented = false;
  private hasDash = false;

  constructor(
    app: App,
    private readonly plugin: OsrTurnTrackerPlugin,
  ) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // Cheap per-line rejection before the buffer scan: a `type:`/`calendar:` value or a key/list anchor.
    const typeMatch = before.match(TYPE_VALUE_RE);
    const calendarMatch = typeMatch ? null : before.match(CALENDAR_VALUE_RE);
    const structMatch = typeMatch || calendarMatch ? null : before.match(STRUCTURE_RE);
    if (!typeMatch && !calendarMatch && !structMatch) return null;

    const { inside, section } = this.scanUp(editor, cursor.line);
    if (!inside) return null;

    if (typeMatch || calendarMatch) {
      this.mode = typeMatch ? "type" : "calendar";
      const value = (typeMatch ?? calendarMatch)![1];
      return { start: { line: cursor.line, ch: cursor.ch - value.length }, end: cursor, query: value };
    }

    const [, indent, dash, word] = structMatch!;
    // Stay quiet on empty top-level lines; in a list section, offer help even on a blank line.
    if (word.length === 0 && section === "top") return null;

    this.mode = "structure";
    this.section = section;
    this.indented = indent.length > 0;
    this.hasDash = !!dash;
    return { start: { line: cursor.line, ch: cursor.ch - word.length }, end: cursor, query: word };
  }

  getSuggestions(context: EditorSuggestContext): TrackerSuggestion[] {
    const q = context.query.toLowerCase();
    // Both value modes append a trailing space to terminate the value, so selecting it doesn't
    // immediately re-fire the same trigger and leave the popup stuck open.
    if (this.mode === "type") {
      return [...this.plugin.settings.presets.map((p) => p.id), CUSTOM_TYPE]
        .filter((id) => id.toLowerCase().startsWith(q))
        .map((id) => ({
          display: id,
          hint: id === CUSTOM_TYPE ? "free-text effect" : "preset",
          insert: `${id} `,
        }));
    }
    if (this.mode === "calendar") {
      return calendarNames()
        .filter((name) => name.toLowerCase().startsWith(q))
        .map((name) => ({ display: name, hint: "calendar", insert: `${name} ` }));
    }

    const out: TrackerSuggestion[] = [];
    const col0 = !this.indented && !this.hasDash;
    const entry = this.section === "top" ? undefined : SECTION_ENTRIES[this.section];

    // Start a new list entry — only when not already mid-entry (no dash) and not typing a key name.
    if (entry && context.query === "" && !this.hasDash) {
      out.push({ display: entry.newLabel, hint: "new entry", insert: `${col0 ? "  - " : "- "}${entry.scaffold}` });
    }
    // Keys of the current entry (on a dashed or indented line within a list section).
    if (entry && (this.hasDash || this.indented)) {
      for (const key of entry.keys) {
        if (key.toLowerCase().startsWith(q)) out.push({ display: `${key}:`, hint: "", insert: `${key}: ` });
      }
    }
    // Top-level keys when writing at column 0.
    if (col0) {
      for (const key of TOP_LEVEL_KEYS) {
        if (key.startsWith(q)) out.push({ display: `${key}:`, hint: "", insert: `${key}: ` });
      }
    }
    return out;
  }

  renderSuggestion(value: TrackerSuggestion, el: HTMLElement): void {
    el.createSpan({ text: value.display });
    if (value.hint) el.createSpan({ cls: "osr-tt-suggest-hint", text: value.hint });
  }

  selectSuggestion(value: TrackerSuggestion): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange(value.insert, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + value.insert.length });
  }

  /**
   * One upward pass answering both questions onTrigger needs: is the cursor inside a turn-tracker
   * fence, and which section is it in (from the nearest column-0 key). The nearest fence above bounds
   * the search — the cursor is "inside" only if that fence opens a turn-tracker block.
   */
  private scanUp(editor: Editor, line: number): { inside: boolean; section: Section } {
    let section: Section = "top";
    let sectionKnown = false;
    for (let i = line - 1; i >= 0; i--) {
      const text = editor.getLine(i);
      const trimmed = text.trim();
      if (FENCE_LINE.test(trimmed)) return { inside: OPEN_FENCE.test(trimmed), section };
      if (!sectionKnown) {
        const m = text.match(/^([A-Za-z]+):/); // a column-0 key sets the enclosing section
        if (m) {
          section = sectionFor(m[1]);
          sectionKnown = true;
        }
      }
    }
    return { inside: false, section: "top" };
  }
}

/** Prompts for a note's free-form text (empty = new note, otherwise editing), then invokes `onSubmit`. */
class NoteModal extends Modal {
  private text: string;
  private saveButton?: ButtonComponent;

  constructor(
    app: App,
    initial: string,
    private readonly onSubmit: (text: string) => void,
  ) {
    super(app);
    this.text = initial;
  }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: this.text ? "Edit note" : "Add note" });
    const input = this.contentEl.createEl("textarea", { cls: "osr-tt-note-input" });
    input.rows = 4;
    input.value = this.text;
    input.addEventListener("input", () => {
      this.text = input.value;
      this.refresh();
    });
    this.contentEl.createEl("div", { text: "Markdown is supported.", cls: "osr-tt-note-help" });
    new Setting(this.contentEl).addButton((b) => {
      this.saveButton = b;
      b.setButtonText("Save").setCta().onClick(() => this.submit());
    });
    // Cmd/Ctrl+Enter saves (plain Enter inserts a newline in the textarea); no-op when empty.
    this.scope.register(["Mod"], "Enter", () => {
      if (this.canSubmit()) this.submit();
      return false;
    });
    this.refresh();
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Save is enabled only once the trimmed text is non-empty. */
  private canSubmit(): boolean {
    return this.text.trim().length > 0;
  }

  private refresh(): void {
    this.saveButton?.setDisabled(!this.canSubmit());
  }

  private submit(): void {
    if (!this.canSubmit()) return;
    this.onSubmit(this.text.trim());
    this.close();
  }
}

/** Usage stats for one custom effect label: how often, and with which duration expressions. */
interface EffectStat {
  /** Total uses. Stored (not derived from `durations`) so legacy entries migrated from the old
   *  count-only format keep their suggestion ranking despite having no recorded durations. */
  count: number;
  /** Tally of the duration expressions used (plain numbers or dice like "2d6+1") → times seen. */
  durations: Record<string, number>;
}

/** What the Add-effect modal needs from history: ranked labels and a per-label duration hint. */
interface EffectHistoryView {
  labels: string[];
  durationFor: (label: string) => string | undefined;
}

/** Coerce persisted history to the current shape, migrating the legacy `label → count` form. */
function normalizeEffectHistory(raw: unknown): Record<string, EffectStat> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, EffectStat> = {};
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number") out[label] = { count: value, durations: {} };
    else if (value && typeof value === "object") {
      const stat = value as { count?: unknown; durations?: unknown };
      const durations: Record<string, number> = {};
      if (stat.durations && typeof stat.durations === "object") {
        for (const [d, c] of Object.entries(stat.durations)) {
          if (typeof c === "number") durations[d] = c;
        }
      }
      out[label] = { count: typeof stat.count === "number" ? stat.count : 0, durations };
    }
  }
  return out;
}

/** Suggests previously-used effect labels (most-used first) as the user types. */
class EffectLabelSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly labels: string[],
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): string[] {
    if (!query) return []; // don't pop the list open on focus, only once the user types
    const q = query.toLowerCase();
    return this.labels.filter((label) => label.toLowerCase().includes(q));
  }

  renderSuggestion(label: string, el: HTMLElement): void {
    el.setText(label);
  }
}

/** Prompts for an ad-hoc effect's label and duration, then invokes `onSubmit`. */
class EffectModal extends Modal {
  private label = "";
  private duration = "1";
  private addButton?: ButtonComponent;

  constructor(
    app: App,
    private readonly history: EffectHistoryView,
    private readonly onSubmit: (label: string, turns: number, duration: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("osr-tt-effect-modal");
    this.contentEl.createEl("h3", { text: "Add effect" });

    let durationField: TextComponent;
    let durationTouched = false;
    // Pre-fill the duration for a known label, unless the user has already set one by hand.
    const fillDuration = (label: string) => {
      if (durationTouched) return;
      const duration = this.history.durationFor(label);
      if (duration === undefined) return;
      this.duration = duration;
      durationField.setValue(this.duration); // setValue doesn't fire onChange, so it stays "untouched"
    };

    new Setting(this.contentEl).setName("Label").addText((t) => {
      t.setPlaceholder("e.g. Poison").onChange((v) => {
        this.label = v.trim();
        fillDuration(this.label);
        this.refresh();
      });
      const suggest = new EffectLabelSuggest(this.app, t.inputEl, this.history.labels);
      suggest.onSelect((label) => {
        t.setValue(label);
        this.label = label;
        fillDuration(label);
        this.refresh();
        suggest.close();
      });
    });
    new Setting(this.contentEl)
      .setName("Duration (turns)")
      .setDesc("A number, or dice rolled now — e.g. 6 or 2d6+1.")
      .addText((t) => {
        durationField = t;
        t.setPlaceholder("e.g. 6 or 2d6+1").setValue(this.duration).onChange((v) => {
          this.duration = v;
          durationTouched = true;
          this.refresh();
        });
      });
    new Setting(this.contentEl).addButton((b) => {
      this.addButton = b;
      b.setButtonText("Add").setCta().onClick(() => this.submit());
    });

    // Cmd/Ctrl+Enter adds, matching the Add button's enabled state.
    this.scope.register(["Mod"], "Enter", () => {
      if (this.canSubmit()) this.submit();
      return false;
    });

    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Add is enabled only once there's a label and a parseable duration. */
  private canSubmit(): boolean {
    return Boolean(this.label && isValidDuration(this.duration));
  }

  private refresh(): void {
    this.addButton?.setDisabled(!this.canSubmit());
  }

  private submit(): void {
    const roll = rollDuration(this.duration);
    if (!roll) return; // guarded by the disabled button; defensive
    if (roll.total < 1) {
      // A 0 is a valid outcome (e.g. 1d3-1 poison that never took) — a zero-length marker would be
      // instantly expired, so skip adding it, but close the dialog rather than force a reroll.
      new Notice(`${this.label} — rolled ${roll.expr}: ${roll.total}, effect not added.`);
      this.close();
      return;
    }
    if (roll.rolled) new Notice(`${this.label} — rolled ${roll.expr}: ${roll.total} turn(s).`);
    this.onSubmit(this.label, roll.total, roll.expr);
    this.close();
  }
}

/** Derive a stable, readable preset id from its label ("Cure Light" → "cure-light") so it serializes
 *  as a meaningful marker `type` instead of an opaque random id. Disambiguated against ids in use. */
function presetIdFromLabel(label: string, existingIds: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "preset";
  if (!existingIds.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
}

/** Edits a light preset's fields (name, icon, duration, pausable) in a modal, then invokes `onSubmit`. */
class PresetModal extends Modal {
  private readonly draft: LightPreset;
  private saveButton?: ButtonComponent;

  constructor(
    app: App,
    private readonly title: string,
    preset: LightPreset,
    /** Names already used by other presets (lowercased) — the new name must not collide. */
    private readonly takenNames: string[],
    private readonly onSubmit: (preset: LightPreset) => void,
  ) {
    super(app);
    this.draft = { ...preset }; // edit a copy; apply only on Save
  }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: this.title });

    new Setting(this.contentEl).setName("Name").addText((t) =>
      t.setValue(this.draft.label).onChange((v) => {
        this.draft.label = v.trim();
        this.refresh();
      }),
    );

    // Icon field with a live preview: an invalid Lucide name shows as an empty box.
    let previewEl: HTMLElement;
    const renderPreview = (name: string) => {
      previewEl.empty();
      if (name) setIcon(previewEl, name);
    };
    const iconSetting = new Setting(this.contentEl)
      .setName("Icon")
      .setDesc("Optional Lucide icon name shown beside the preset in menus.")
      .addText((t) =>
        t
          .setPlaceholder("e.g. lightbulb")
          .setValue(this.draft.icon ?? "")
          .onChange((v) => {
            const icon = v.trim();
            if (icon) this.draft.icon = icon;
            else delete this.draft.icon;
            renderPreview(icon);
          }),
      );
    previewEl = iconSetting.controlEl.createSpan({ cls: "osr-tt-preset-icon-preview" });
    renderPreview(this.draft.icon ?? "");

    new Setting(this.contentEl)
      .setName("Duration (turns)")
      .setDesc("A number, or dice rolled when lit — e.g. 6 or 2d6+1.")
      .addText((t) =>
        t
          .setPlaceholder("e.g. 6 or 2d6+1")
          .setValue(this.draft.turns)
          .onChange((v) => {
            this.draft.turns = v;
            this.refresh();
          }),
      );

    new Setting(this.contentEl)
      .setName("Pausable")
      .setDesc("Can be paused and resumed on the tracker (like a light source).")
      .addToggle((t) =>
        t.setValue(this.draft.pausable ?? false).onChange((v) => (this.draft.pausable = v)),
      );

    new Setting(this.contentEl).addButton((b) => {
      this.saveButton = b;
      b.setButtonText("Save").setCta().onClick(() => this.submit());
    });

    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Enable Save only with a non-empty, unique name and a parseable duration. */
  private refresh(): void {
    this.saveButton?.setDisabled(!this.isValid());
  }

  private isValid(): boolean {
    if (!this.draft.label) return false;
    if (this.takenNames.includes(this.draft.label.toLowerCase())) return false;
    return isValidDuration(this.draft.turns);
  }

  private submit(): void {
    if (!this.isValid()) return;
    const roll = rollDuration(this.draft.turns);
    if (roll) this.draft.turns = roll.expr; // store the canonical expression
    this.onSubmit(this.draft);
    this.close();
  }
}

/** Settings tab: manage light presets, advance shortcuts, and the look-ahead buffer. */
class OsrSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OsrTurnTrackerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    containerEl.addClass("osr-tt-settings"); // scope for the disabled-row styling

    // Group the turn tracker's settings under its own heading, nested so the heading reads as their
    // parent (not a sibling of the sub-sections). Other tools' settings sit beside it as we grow.
    new Setting(containerEl).setName("Turn Tracker").setHeading();
    const body = containerEl.createDiv({ cls: "osr-settings-group" });

    new Setting(body)
      .setName("Look-ahead buffer")
      .setDesc("Turns rendered past the furthest marker.")
      .addText((t) =>
        this.numberInput(t, 0, () => s.lookaheadBuffer, (n) => (s.lookaheadBuffer = n)),
      );

    new Setting(body)
      .setName("Advance shortcuts (hours)")
      .setDesc("Comma-separated. Buttons update live; commands take effect after reload.")
      .addText((t) =>
        t.setValue(s.advanceShortcuts.join(", ")).onChange(async (v) => {
          const hours = v
            .split(",")
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isInteger(n) && n > 0);
          s.advanceShortcuts = [...new Set(hours)];
          await this.plugin.saveSettings();
        }),
      );

    this.propertyText(body, {
      name: "In-game date property",
      desc: "Note frontmatter property a new tracker reads its in-game start date from.",
      value: s.startProperty,
      fallback: DEFAULT_START_PROPERTY,
      set: (v) => (s.startProperty = v),
    });

    const calendariumAvailable = isCalendariumAvailable();

    new Setting(body).setName("Calendarium").setHeading();
    if (!calendariumAvailable) {
      new Setting(body).setDesc(
        "The Calendarium plugin isn't installed or enabled, so these options are unavailable.",
      );
    }

    this.propertyText(body, {
      name: "Calendar property",
      desc:
        "Note frontmatter property a new tracker reads its calendar name from. " +
        "Falls back to Calendarium's default calendar when unset.",
      value: s.calendarProperty,
      fallback: DEFAULT_CALENDAR_PROPERTY,
      disabled: !calendariumAvailable,
      set: (v) => (s.calendarProperty = v),
    });

    new Setting(body)
      .setName("Sync current date")
      .setDesc(
        "When a turn advances to a new day, set the Calendarium calendar's current date to the tracker's date. Requires a start date.",
      )
      // Row .setDisabled dims + blocks the mouse (via CSS); the control's own .setDisabled also blocks
      // keyboard focus — both are needed for a fully-disabled row.
      .setDisabled(!calendariumAvailable)
      .addToggle((t) =>
        t
          .setValue(s.syncCalendariumDate)
          .setDisabled(!calendariumAvailable)
          .onChange(async (v) => {
            s.syncCalendariumDate = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(body)
      .setName("Presets")
      .setHeading()
      .addExtraButton((b) =>
        b.setIcon("rotate-ccw").setTooltip("Reset to defaults").onClick(() =>
          new ConfirmModal(
            this.app,
            "Reset presets to the defaults? Your custom presets will be removed.",
            async () => {
              s.presets = createDefaultSettings().presets;
              await this.plugin.saveSettings();
              this.display();
            },
            "Reset",
          ).open(),
        ),
      )
      .addExtraButton((b) =>
        b.setIcon("plus").setTooltip("Add preset").onClick(() =>
          this.createPreset({ id: "", label: "New light", turns: "6", pausable: true }),
        ),
      );

    // One standard (responsive) row per preset — name + summary, with reorder / Edit / Delete. The
    // fields are edited in a modal; the first preset is the widget's default (primary) button, so
    // reordering is how the user chooses the default.
    const swapPresets = async (a: number, b: number) => {
      [s.presets[a], s.presets[b]] = [s.presets[b], s.presets[a]];
      await this.plugin.saveSettings();
      this.display();
    };

    s.presets.forEach((preset, i) => {
      const row = new Setting(body)
        .setName(preset.label || "(unnamed)")
        .setDesc(
          `${preset.turns} turn${preset.turns === "1" ? "" : "s"}` +
            `${preset.pausable ? " · pausable" : ""}${i === 0 ? " · default" : ""}`,
        );

      if (preset.icon) {
        const iconEl = createSpan({ cls: "osr-tt-preset-list-icon" });
        setIcon(iconEl, preset.icon);
        row.nameEl.prepend(iconEl);
      }

      row
        .addExtraButton((b) =>
          b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => swapPresets(i, i - 1)),
        )
        .addExtraButton((b) =>
          b
            .setIcon("arrow-down")
            .setTooltip("Move down")
            .setDisabled(i === s.presets.length - 1)
            .onClick(() => swapPresets(i, i + 1)),
        )
        .addExtraButton((b) =>
          b.setIcon("pencil").setTooltip("Edit").onClick(() =>
            new PresetModal(
              this.app,
              "Edit preset",
              preset,
              s.presets.filter((_, j) => j !== i).map((p) => p.label.toLowerCase()),
              async (updated) => {
                s.presets[i] = updated;
                await this.plugin.saveSettings();
                this.display();
              },
            ).open(),
          ),
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Remove").onClick(() =>
            new ConfirmModal(this.app, `Remove the "${preset.label || "unnamed"}" preset?`, async () => {
              s.presets.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            }).open(),
          ),
        );
    });

    const history = this.plugin.effectHistoryView();

    const historyHeading = new Setting(body)
      .setName("Effect history")
      .setDesc("Custom-effect labels learned for autocomplete and duration pre-fill.")
      .setHeading();
    if (history.length > 0) {
      historyHeading.addExtraButton((b) =>
        b.setIcon("trash").setTooltip("Forget all").onClick(() =>
          new ConfirmModal(this.app, "Forget all recorded custom effects?", async () => {
            await this.plugin.forgetAllEffects();
            this.display();
          }).open(),
        ),
      );
    }

    if (history.length === 0) {
      new Setting(body).setDesc("No custom effects recorded yet.");
    } else {
      for (const entry of history) {
        const durations = entry.durations
          .map(([expr, count]) => (count > 1 ? `${expr} (×${count})` : expr))
          .join(", ");
        new Setting(body)
          .setName(entry.label)
          .setDesc(`Used ${entry.count}× · ${durations}`)
          .addExtraButton((b) =>
            b.setIcon("list-plus").setTooltip("Promote to preset").onClick(() => {
              // Seed the preset's duration from the effect's most-used expression (dice and all —
              // presets now hold expressions too); the modal lets the user finalize the rest.
              const turns = [...entry.durations].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "6";
              // The effect lives on as a preset, so retire its history entry.
              this.createPreset({ id: "", label: entry.label, turns, pausable: false }, () =>
                this.plugin.forgetEffect(entry.label),
              );
            }),
          )
          .addExtraButton((b) =>
            b.setIcon("trash").setTooltip("Forget").onClick(() =>
              new ConfirmModal(this.app, `Forget the "${entry.label}" effect?`, async () => {
                await this.plugin.forgetEffect(entry.label);
                this.display();
              }).open(),
            ),
          );
      }
    }
  }

  /** Open the preset editor seeded with `seed`, append the result with an id derived from its name,
   *  and refresh. `afterCreate` runs any follow-up (e.g. retiring the promoted effect's history). */
  private createPreset(seed: LightPreset, afterCreate?: () => Promise<void>): void {
    const s = this.plugin.settings;
    new PresetModal(
      this.app,
      "Add preset",
      seed,
      s.presets.map((p) => p.label.toLowerCase()),
      async (created) => {
        created.id = presetIdFromLabel(created.label, s.presets.map((p) => p.id));
        s.presets.push(created);
        await this.plugin.saveSettings();
        if (afterCreate) await afterCreate();
        this.display();
      },
    ).open();
  }

  /** A settings row for a frontmatter-property name: trims input and restores the default when
   *  cleared. When `disabled`, the row is dimmed/mouse-blocked (row) and keyboard-blocked (control). */
  private propertyText(
    containerEl: HTMLElement,
    opts: {
      name: string;
      desc: string;
      value: string;
      fallback: string;
      disabled?: boolean;
      set: (value: string) => void;
    },
  ): void {
    new Setting(containerEl)
      .setName(opts.name)
      .setDesc(opts.desc)
      .setDisabled(!!opts.disabled)
      .addText((t) =>
        t
          .setPlaceholder(opts.fallback)
          .setValue(opts.value)
          .setDisabled(!!opts.disabled)
          .onChange(async (v) => {
            opts.set(v.trim() || opts.fallback);
            await this.plugin.saveSettings();
          }),
      );
  }

  /** Wire a text field as a whole-number input (≥ min) that persists valid values. */
  private numberInput(
    t: TextComponent,
    min: number,
    get: () => number,
    set: (n: number) => void,
  ): void {
    t.inputEl.type = "number";
    t.inputEl.min = String(min);
    t.setValue(String(get())).onChange(async (v) => {
      const n = Number(v);
      if (Number.isInteger(n) && n >= min) {
        set(n);
        await this.plugin.saveSettings();
      }
    });
  }
}
