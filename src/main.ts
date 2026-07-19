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
  Setting,
  setIcon,
  TextComponent,
  TFile,
} from "obsidian";
import { applyAction } from "./core/apply";
import { BlockCodec, NoteContext } from "./core/tool";
import { PluginTool } from "./host";
import { createChargeTrackerTool } from "./tools/charge-tracker";
import { ConfirmModal } from "./ui/confirm-modal";
import { BlockRange } from "./tools/turn-tracker/block";
import {
  EffectHistory,
  effectHistoryView,
  normalizeEffectHistory,
} from "./tools/turn-tracker/effect-history";
import { isCalendariumAvailable } from "./tools/turn-tracker/calendarium";
import { PresetModal, presetIdFromLabel } from "./tools/turn-tracker/modals";
import { LightPreset, nonEmptyString } from "./tools/turn-tracker/model";
import { renderError } from "./tools/turn-tracker/render";
import { createTurnTrackerTool, TurnTrackerHost } from "./tools/turn-tracker/tool";
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

export default class OsrTurnTrackerPlugin extends Plugin {
  settings: OsrTurnTrackerSettings = createDefaultSettings();

  /** Serializes writes so rapid clicks can't race on a stale block snapshot. */
  private applying = false;

  /** Per custom-effect-label usage: total count and a tally of the durations it was used with.
   *  Owned here (persisted in `data.json`); the turn-tracker tool reads and mutates it via the host. */
  private effectHistory: EffectHistory = {};

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
    this.registerTool(createChargeTrackerTool(this.app));
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, effectHistory: this.effectHistory });
  }

  /** Recorded custom-effect labels with their usage (most-used first), for the settings view. */
  effectHistoryView(): { label: string; count: number; durations: [string, number][] }[] {
    return effectHistoryView(this.effectHistory);
  }

  /** Forget a recorded custom-effect label so it no longer suggests or pre-fills a duration. */
  async forgetEffect(label: string): Promise<void> {
    delete this.effectHistory[label];
    await this.saveSettings();
  }

  /** Forget every recorded custom-effect label. Cleared in place so the tool's shared reference to
   *  the store stays valid. */
  async forgetAllEffects(): Promise<void> {
    for (const key of Object.keys(this.effectHistory)) delete this.effectHistory[key];
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
