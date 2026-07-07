import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
  TFile,
} from "obsidian";
import { parseTrackerState } from "./parse";
import { renderError, renderTracker } from "./render";
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
  toggleAt,
} from "./actions";
import { applyTrackerAction } from "./apply";
import { BlockRange, findTrackerBlockAt } from "./block";
import { fenceTrackerBlock } from "./serialize";
import { seedTrackerState } from "./seed";
import { LightPreset, TRACKER_LANG, TURNS_PER_DAY, Transform, TrackerState, dayOf } from "./model";
import { makeFantasyDayHeader } from "./calendarium";
import { createDefaultSettings, OsrTurnTrackerSettings } from "./settings";

export default class OsrTurnTrackerPlugin extends Plugin {
  settings: OsrTurnTrackerSettings = createDefaultSettings();

  /** Serializes writes so rapid clicks can't race on a stale block snapshot. */
  private applying = false;

  /** Notify at most once per session when a block's calendar can't be resolved. */
  private calendarWarned = false;

  async onload() {
    // Validate each field against malformed/stale persisted data rather than trusting the shape.
    const loaded = (await this.loadData()) ?? {};
    const defaults = createDefaultSettings();
    this.settings = {
      presets: Array.isArray(loaded.presets)
        ? loaded.presets.map((p: LightPreset) => ({ ...p }))
        : defaults.presets,
      advanceShortcuts: Array.isArray(loaded.advanceShortcuts)
        ? [...loaded.advanceShortcuts]
        : defaults.advanceShortcuts,
      lookaheadBuffer:
        typeof loaded.lookaheadBuffer === "number" ? loaded.lookaheadBuffer : defaults.lookaheadBuffer,
    };
    this.addSettingTab(new OsrSettingsTab(this.app, this));

    // Processors registered on the plugin are auto-detached on unload.
    this.registerMarkdownCodeBlockProcessor(TRACKER_LANG, (source, el, ctx) => {
      const result = parseTrackerState(source);
      if (!result.ok) {
        renderError(el, result.error);
        return;
      }
      renderTracker(el, result.state, this.settings, {
        onEndTurn: () => void this.mutateFromWidget(el, ctx, endTurn),
        onAdvanceHours: (hours) => void this.mutateFromWidget(el, ctx, advanceHours(hours)),
        onBoxClick: (turn) => void this.mutateFromWidget(el, ctx, toggleAt(turn)),
        onLight: (preset, turns) => void this.mutateFromWidget(el, ctx, lightSource(preset, turns)),
        onAddEffect: () =>
          new EffectModal(this.app, (label, turns) =>
            void this.mutateFromWidget(el, ctx, addEffect(label, turns)),
          ).open(),
        onClearExpired: () => void this.mutateFromWidget(el, ctx, clearExpired),
        onClearAll: () => void this.mutateFromWidget(el, ctx, clearAll),
        onRemoveMarker: (kind, index, label) =>
          new ConfirmModal(this.app, `Remove "${label}"?`, () =>
            void this.mutateFromWidget(el, ctx, removeMarker(kind, index)),
          ).open(),
        onRenameMarker: (kind, index, name) =>
          void this.mutateFromWidget(el, ctx, renameMarker(kind, index, name)),
        onPause: (kind, index) => void this.mutateFromWidget(el, ctx, pauseMarker(kind, index)),
        onResume: (kind, index) => void this.mutateFromWidget(el, ctx, resumeMarker(kind, index)),
        onSetRemaining: (kind, index, turns) =>
          void this.mutateFromWidget(el, ctx, setRemaining(kind, index, turns)),
        onCopyState: () => void this.copyState(result.state),
      }, makeFantasyDayHeader(result.state, () => this.warnCalendar()));
    });

    this.addCommand({
      id: "end-turn",
      name: "End turn",
      editorCallback: (editor) => void this.mutateFromEditor(editor, endTurn),
    });

    // Registered from settings at load; changing the list takes effect on reload.
    for (const hours of this.settings.advanceShortcuts) {
      this.addCommand({
        id: `advance-${hours}h`,
        name: `Advance ${hours} hour${hours === 1 ? "" : "s"}`,
        editorCallback: (editor) => void this.mutateFromEditor(editor, advanceHours(hours)),
      });
    }

    this.addCommand({
      id: "insert-tracker",
      name: "Insert turn tracker",
      editorCallback: (editor) => {
        const file = this.app.workspace.getActiveFile();
        const frontmatter = file
          ? this.app.metadataCache.getFileCache(file)?.frontmatter
          : undefined;
        editor.replaceSelection(`${fenceTrackerBlock(seedTrackerState(frontmatter))}\n`);
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Write path for a click inside a rendered widget: block located via getSectionInfo. */
  private async mutateFromWidget(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    transform: Transform,
  ): Promise<void> {
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!info || !(file instanceof TFile)) {
      new Notice("Could not locate the tracker block.");
      return;
    }
    // info.text and its line numbers are a consistent snapshot taken at click time.
    await this.applyToFile(file, info.text, { lineStart: info.lineStart, lineEnd: info.lineEnd }, transform);
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
    await this.applyToFile(file, text, range, transform);
  }

  private async applyToFile(
    file: TFile,
    sourceText: string,
    range: BlockRange,
    transform: Transform,
  ): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      const result = applyTrackerAction(sourceText, range, transform);
      if (!result.ok) {
        new Notice(result.error);
        return;
      }
      await this.app.vault.modify(file, result.newText);
    } finally {
      this.applying = false;
    }
  }

  private warnCalendar(): void {
    if (this.calendarWarned) return;
    this.calendarWarned = true;
    new Notice("OSR Turn Tracker: couldn't read the Calendarium calendar — using default dates.");
  }

  /** Copy the tracker as a `turn-tracker` code block, ready to paste into another note. */
  private async copyState(state: TrackerState): Promise<void> {
    // Stamp the render origin at the current day's start so a pasted clone doesn't replay prior days.
    const origin = dayOf(state.position) * TURNS_PER_DAY;
    try {
      await navigator.clipboard.writeText(fenceTrackerBlock({ ...state, origin }));
      new Notice("Tracker state copied to clipboard.");
    } catch {
      new Notice("OSR Turn Tracker: couldn't access the clipboard.");
    }
  }
}

/** A yes/no confirmation dialog; runs `onConfirm` only if the user confirms. */
class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText("Remove").onClick(() => {
          this.onConfirm();
          this.close();
        });
        b.buttonEl.addClass("mod-warning");
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Prompts for an ad-hoc effect's label and duration, then invokes `onSubmit`. */
class EffectModal extends Modal {
  private label = "";
  private turns = "1";

  constructor(
    app: App,
    private readonly onSubmit: (label: string, turns: number) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: "Add effect" });

    new Setting(this.contentEl).setName("Label").addText((t) =>
      t.setPlaceholder("e.g. Poison").onChange((v) => (this.label = v.trim())),
    );
    new Setting(this.contentEl).setName("Duration (turns)").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "1";
      t.setValue(this.turns).onChange((v) => (this.turns = v));
    });
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Add").setCta().onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const turns = Number(this.turns);
    if (!this.label || !Number.isInteger(turns) || turns < 1) {
      new Notice("Enter a label and a whole number of turns ≥ 1.");
      return;
    }
    this.onSubmit(this.label, turns);
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

    new Setting(containerEl)
      .setName("Look-ahead buffer")
      .setDesc("Turns rendered past the furthest marker.")
      .addText((t) =>
        this.numberInput(t, 0, () => s.lookaheadBuffer, (n) => (s.lookaheadBuffer = n)),
      );

    new Setting(containerEl)
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

    new Setting(containerEl).setName("Light presets").setHeading();

    s.presets.forEach((preset, i) => {
      new Setting(containerEl)
        .addText((t) =>
          t.setPlaceholder("Label").setValue(preset.label).onChange(async (v) => {
            preset.label = v;
            await this.plugin.saveSettings();
          }),
        )
        .addText((t) => {
          t.inputEl.size = 3;
          t.setPlaceholder("Glyph").setValue(preset.marker).onChange(async (v) => {
            preset.marker = v;
            await this.plugin.saveSettings();
          });
        })
        .addText((t) => this.numberInput(t, 1, () => preset.turns, (n) => (preset.turns = n)))
        .addToggle((t) =>
          t
            .setTooltip("Pausable")
            .setValue(preset.pausable ?? false)
            .onChange(async (v) => {
              preset.pausable = v;
              await this.plugin.saveSettings();
            }),
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Remove").onClick(async () => {
            s.presets.splice(i, 1);
            await this.plugin.saveSettings();
            this.display();
          }),
        );
    });

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Add preset").onClick(async () => {
        s.presets.push({
          id: `preset-${Math.random().toString(36).slice(2, 8)}`,
          label: "New light",
          marker: "?",
          turns: 6,
          pausable: true,
        });
        await this.plugin.saveSettings();
        this.display();
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
