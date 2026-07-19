import {
  App,
  Hotkey,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  MarkdownView,
  Modifier,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  TFile,
} from "obsidian";
import { applyAction } from "./core/apply";
import { BlockCodec, NoteContext } from "./core/tool";
import { PluginTool } from "./host";
import { createChargeTrackerTool } from "./tools/charge-tracker";
import { BlockRange } from "./tools/turn-tracker/block";
import { EffectHistory, normalizeEffectHistory } from "./tools/turn-tracker/effect-history";
import { LightPreset, nonEmptyString } from "./tools/turn-tracker/model";
import { renderError } from "./tools/turn-tracker/render";
import { createTurnTrackerTool, TurnTrackerHost } from "./tools/turn-tracker/tool";
import { createDefaultSettings, OsrTurnTrackerSettings } from "./tools/turn-tracker/settings";

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

/** What the settings tab needs from a registered tool: its optional section renderer. Narrowing the
 *  registry to this (rather than `PluginTool<unknown>`) avoids an unsound `S` widening — `PluginTool`
 *  is invariant in `S` — and hides the rest of a tool's surface from the tab. */
type ToolSettingsContributor = { settingsSection?(containerEl: HTMLElement): void };

export default class OsrTurnTrackerPlugin extends Plugin {
  settings: OsrTurnTrackerSettings = createDefaultSettings();

  /** Serializes writes so rapid clicks can't race on a stale block snapshot. */
  private applying = false;

  /** Per custom-effect-label usage: total count and a tally of the durations it was used with.
   *  Owned here (persisted in `data.json`); the turn-tracker tool reads and mutates it via the host. */
  private effectHistory: EffectHistory = {};

  /** Every registered tool, so the settings tab can render each one's section. */
  readonly tools: ToolSettingsContributor[] = [];

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
    // plugin are auto-detached on unload. The turn tracker depends on this plugin via a small host
    // seam; the charge tracker needs only `app`.
    const host: TurnTrackerHost = {
      app: this.app,
      settings: this.settings,
      effectHistory: this.effectHistory,
      saveSettings: () => this.saveSettings(),
      applyToFile: (file, sourceText, range, codec, transform, afterWrite) =>
        this.applyToFile(file, sourceText, range, codec, transform, afterWrite),
      frontmatterAt: (path) => this.frontmatterAt(path),
      registerEditorSuggest: this.registerEditorSuggest.bind(this),
    };
    this.registerTool(createTurnTrackerTool(host));
    this.registerTool(
      createChargeTrackerTool({
        app: this.app,
        applyToFile: (file, sourceText, range, codec, transform) =>
          this.applyToFile(file, sourceText, range, codec, transform),
      }),
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, effectHistory: this.effectHistory });
  }

  /** Register a tool with the host: track it for the settings tab, add its editor commands, and wire
   *  its code-block processor (parse via codec → resolve/validate → render with a `mutate` bridge onto
   *  the shared write funnel). */
  private registerTool<S>(tool: PluginTool<S>): void {
    this.tools.push(tool);
    for (const command of tool.commands?.() ?? []) {
      // Enforce ToolCommand's "set exactly one callback" contract — a command with neither would
      // register as a dead no-op, one with both is ambiguous. Fail loudly at load, not silently.
      if (!command.callback === !command.editorCallback) {
        throw new Error(`Command "${command.id}" must set exactly one of callback / editorCallback.`);
      }
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
}

/** The plugin's single settings tab: a shell that lets each registered tool render its own section.
 *  All tool-specific rows live in the tools; this owns only the container. */
class OsrSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OsrTurnTrackerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    for (const tool of this.plugin.tools) tool.settingsSection?.(this.containerEl);
  }
}
