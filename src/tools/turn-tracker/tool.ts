/** The turn tracker as a self-contained plugin tool: its codec, frontmatter resolution, widget,
 *  editor commands, modals, and autocomplete — all behind a small `TurnTrackerHost` seam so the
 *  plugin host (main.ts) stays tool-neutral. */

import { App, Editor, Notice, Plugin, TFile } from "obsidian";
import { BlockCodec, NoteContext, RenderContext } from "../../core/tool";
import { rollDuration } from "../../core/dice";
import { ConfirmModal } from "../../ui/confirm-modal";
import { PluginTool, ToolCommand } from "../../host";
import {
  addEffect,
  advanceHours,
  addNote,
  clearAll,
  clearExpired,
  editNote,
  endTurn,
  lightSource,
  pauseMarker,
  removeMarker,
  removeNote,
  renameMarker,
  resumeMarker,
  setRemaining,
  toggleAt,
} from "./actions";
import { trackerCodec } from "./apply";
import { BlockRange, findTrackerBlockAt } from "./block";
import {
  calendarError,
  currentDateAsStart,
  defaultCalendarName,
  makeFantasyDayHeader,
  setCalendariumCurrentDate,
  startDateError,
} from "./calendarium";
import { commandIds, turnTrackerCommandSpecs } from "./commands";
import { durationFor, EffectHistory, frequentEffectLabels, recordEffect } from "./effect-history";
import { EffectModal, NoteModal } from "./modals";
import {
  dayOf,
  TRACKER_LANG,
  TrackerState,
  Transform,
  TURNS_PER_DAY,
} from "./model";
import { renderTracker } from "./render";
import { seedTrackerState } from "./seed";
import { fenceTrackerBlock } from "./serialize";
import { TrackerSuggest } from "./suggest";
import { OsrTurnTrackerSettings } from "./settings";

/** The slice of the plugin host the turn tracker depends on: its settings and effect-history stores
 *  (owned by the host, persisted via `saveSettings`), the shared write funnel, frontmatter access,
 *  and editor-suggest registration. Deliberately no wider than the tool needs. */
export interface TurnTrackerHost {
  app: App;
  settings: OsrTurnTrackerSettings;
  effectHistory: EffectHistory;
  saveSettings(): Promise<void>;
  applyToFile(
    file: TFile,
    sourceText: string,
    range: BlockRange,
    codec: BlockCodec<TrackerState>,
    transform: Transform,
    afterWrite?: (before: TrackerState, after: TrackerState) => void,
  ): Promise<void>;
  frontmatterAt(path: string): Record<string, unknown> | undefined;
  registerEditorSuggest: Plugin["registerEditorSuggest"];
}

/** The turn tracker's glue, bound to a host. Constructed once and exposed as a `PluginTool`. */
class TurnTrackerTool {
  /** Notify at most once per session when a block's calendar can't be resolved. */
  private calendarWarned = false;

  constructor(private readonly host: TurnTrackerHost) {}

  /** The tool's contract for the host: codec, frontmatter resolution, widget, and commands. */
  module(): PluginTool<TrackerState> {
    return {
      id: TRACKER_LANG,
      lang: TRACKER_LANG,
      displayName: "Turn tracker",
      codec: trackerCodec,
      afterWrite: this.syncCalendarDay,
      commands: () => this.commands(),
      prepare: (state, note, backfill) => this.prepare(state, note, backfill),
      render: (ctx) => this.renderWidget(ctx),
    };
  }

  private prepare(
    state: TrackerState,
    note: NoteContext,
    backfill: (transform: Transform) => void,
  ): { state: TrackerState } | { error: string } {
    // Resolve the effective calendar/start: the block's own values (authoritative once written),
    // then note frontmatter (fills a block that still lacks its own value, so a corrected
    // frontmatter reloads it), then Calendarium's default calendar / current date.
    const resolved = this.resolveState(state, note.frontmatter);
    // A typo'd calendar name or an unparseable start fails loudly rather than silently defaulting.
    const calErr = calendarError(resolved.calendar) ?? startDateError(resolved.calendar, resolved.start);
    if (calErr) return { error: calErr };
    // Anchor a block missing calendar/start by persisting the resolved values (the host skips the
    // write while the file is open in an editor, to avoid racing its buffer).
    if ((resolved.calendar && !state.calendar) || (resolved.start && !state.start)) {
      backfill((s) => this.fillMissing(s, resolved, false));
    }
    return { state: { ...state, calendar: resolved.calendar, start: resolved.start } };
  }

  /** The turn tracker's editor commands: each spec (from the shared builder) paired with the editor
   *  action for its id. Dynamic commands (advance shortcuts, light presets) are read from settings at
   *  load; changing the lists takes effect on reload. */
  private commands(): ToolCommand[] {
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
        this.host.settings.advanceShortcuts.map((h) => [commandIds.advance(h), run(advanceHours(h))]),
      ),
      ...Object.fromEntries(
        this.host.settings.presets.map((preset) => [
          commandIds.light(preset.id),
          (editor: Editor) => {
            const transform = this.lightTransform(preset.id);
            if (transform) void this.mutateFromEditor(editor, transform);
          },
        ]),
      ),
    };
    return turnTrackerCommandSpecs(this.host.settings.advanceShortcuts, this.host.settings.presets).map(
      (spec) => {
        const editorCallback = actions[spec.id];
        if (!editorCallback) throw new Error(`Turn tracker command "${spec.id}" has no action.`);
        return { id: spec.id, name: spec.name, editorCallback };
      },
    );
  }

  /** Insert a fresh, self-contained tracker block at the cursor, pre-filled from note frontmatter. */
  private insertTracker(editor: Editor): void {
    const file = this.host.app.workspace.getActiveFile();
    const frontmatter = file ? this.host.frontmatterAt(file.path) : undefined;
    // Pre-fill valid calendar/start here (a safe editor write) so the block is self-contained; an
    // invalid frontmatter value is left out and surfaces as an error on render.
    const base: TrackerState = { position: 0, markers: [] };
    const state = this.fillMissing(base, this.resolveState(base, frontmatter), true);
    editor.replaceSelection(`${fenceTrackerBlock(state)}\n`);
  }

  /** Build the tracker widget's handlers from the generic `mutate` bridge and render it. */
  private renderWidget(ctx: RenderContext<TrackerState>): void {
    // Fill the block's missing calendar/start (from live frontmatter) on each user action, so the
    // first write anchors them. Reads frontmatter fresh at click time, not at render time.
    const mutate = (transform: Transform): void =>
      ctx.mutate(this.withResolvedDefaults(transform, this.host.frontmatterAt(ctx.sourcePath)));
    renderTracker(
      ctx.container,
      ctx.state,
      this.host.settings,
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
          new ConfirmModal(this.host.app, `Remove "${label}"?`, () => mutate(removeMarker(index))).open(),
        onRenameMarker: (index, name) => mutate(renameMarker(index, name)),
        onPause: (index) => mutate(pauseMarker(index)),
        onResume: (index) => mutate(resumeMarker(index)),
        onSetRemaining: (index, turns) => mutate(setRemaining(index, turns)),
        onCopyState: () => void this.copyState(ctx.state),
        onAddNote: (at) => this.openNoteModal(at, mutate),
        onEditNote: (index, text) =>
          new NoteModal(this.host.app, text, (next) => mutate(editNote(index, next))).open(),
        onDeleteNote: (index) =>
          new ConfirmModal(this.host.app, "Delete this note?", () => mutate(removeNote(index))).open(),
        hotkey: (commandId) => ctx.hotkeyLabel(commandId),
      },
      makeFantasyDayHeader(ctx.state, () => this.warnCalendar()),
      ctx.renderMarkdown,
    );
  }

  /** Roll a preset's duration and build the transform that lights it, or return undefined (after a
   *  notice) when the duration is invalid. Shared by the widget button and the light hotkey command. */
  private lightTransform(presetId: string, startsAt?: number): Transform | undefined {
    const preset = this.host.settings.presets.find((p) => p.id === presetId);
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
    new NoteModal(this.host.app, "", (text) => commit(addNote(text, at))).open();
  }

  /** Open the "add effect" modal, committing the resulting transform via `commit` and recording the
   *  effect for autocomplete. Shared by the widget button and the effect hotkey command. */
  private openEffectModal(startsAt: number | undefined, commit: (transform: Transform) => void): void {
    new EffectModal(
      this.host.app,
      {
        labels: frequentEffectLabels(this.host.effectHistory),
        durationFor: (l) => durationFor(this.host.effectHistory, l),
      },
      (label, turns, duration) => {
        commit(addEffect(label, turns, startsAt));
        recordEffect(this.host.effectHistory, label, duration);
        void this.host.saveSettings();
      },
    ).open();
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
      calendarProperty: this.host.settings.calendarProperty,
      startProperty: this.host.settings.startProperty,
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
    const file = this.host.app.workspace.getActiveFile();
    if (!file) return;
    const text = editor.getValue();
    const range = findTrackerBlockAt(text, editor.getCursor().line);
    if (!range) {
      new Notice("Place the cursor in a turn-tracker block.");
      return;
    }
    const frontmatter = this.host.frontmatterAt(file.path);
    await this.host.applyToFile(
      file,
      text,
      range,
      trackerCodec,
      this.withResolvedDefaults(transform, frontmatter),
      this.syncCalendarDay,
    );
  }

  /** Post-write side effect: push the new in-game day into Calendarium when an action crossed a day
   *  boundary. Passed to the write funnel so the funnel itself stays tool-neutral. */
  private syncCalendarDay = (before: TrackerState, after: TrackerState): void => {
    if (this.host.settings.syncCalendariumDate && dayOf(after.position) !== dayOf(before.position)) {
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

/** Build the turn tracker tool for `host` and register its editor autocomplete, mirroring
 *  `createChargeTrackerTool(app)`. */
export function createTurnTrackerTool(host: TurnTrackerHost): PluginTool<TrackerState> {
  host.registerEditorSuggest(new TrackerSuggest(host.app, host.settings));
  return new TurnTrackerTool(host).module();
}
