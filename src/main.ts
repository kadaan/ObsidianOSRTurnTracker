import {
  AbstractInputSuggest,
  App,
  Editor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
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
  addNote,
  editNote,
  removeNote,
  toggleAt,
} from "./actions";
import { applyTrackerAction } from "./apply";
import { rollDuration } from "./dice";
import { BlockRange, findTrackerBlockAt } from "./block";
import { fenceTrackerBlock } from "./serialize";
import { seedTrackerState } from "./seed";
import {
  LightPreset,
  PRESET_FALLBACK_ICON,
  TRACKER_LANG,
  TURNS_PER_DAY,
  Transform,
  TrackerState,
  dayOf,
} from "./model";
import { makeFantasyDayHeader } from "./calendarium";
import { createDefaultSettings, OsrTurnTrackerSettings } from "./settings";

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
        ? loaded.presets.map((p: LightPreset) => ({ ...p }))
        : defaults.presets,
      advanceShortcuts: Array.isArray(loaded.advanceShortcuts)
        ? [...loaded.advanceShortcuts]
        : defaults.advanceShortcuts,
      lookaheadBuffer:
        typeof loaded.lookaheadBuffer === "number" ? loaded.lookaheadBuffer : defaults.lookaheadBuffer,
    };
    this.effectHistory = normalizeEffectHistory(loaded.effectHistory);
    this.addSettingTab(new OsrSettingsTab(this.app, this));

    // Processors registered on the plugin are auto-detached on unload.
    this.registerMarkdownCodeBlockProcessor(TRACKER_LANG, (source, el, ctx) => {
      const result = parseTrackerState(source);
      if (!result.ok) {
        renderError(el, result.error);
        return;
      }
      // Own any markdown render-children on a child scoped to this block, so they unload when the
      // block re-renders. Passing the plugin as owner would leak them until the plugin unloads.
      const renderChild = new MarkdownRenderChild(el);
      ctx.addChild(renderChild);
      renderTracker(el, result.state, this.settings, {
        onEndTurn: () => void this.mutateFromWidget(el, ctx, endTurn),
        onAdvanceHours: (hours) => void this.mutateFromWidget(el, ctx, advanceHours(hours)),
        onBoxClick: (turn) => void this.mutateFromWidget(el, ctx, toggleAt(turn)),
        onLight: (preset, turns, startsAt) =>
          void this.mutateFromWidget(el, ctx, lightSource(preset, turns, startsAt)),
        onAddEffect: (startsAt) =>
          new EffectModal(
            this.app,
            { labels: this.frequentEffectLabels(), durationFor: (l) => this.durationFor(l) },
            (label, turns, duration) => {
              void this.mutateFromWidget(el, ctx, addEffect(label, turns, startsAt));
              this.recordEffect(label, duration);
            },
          ).open(),
        onClearExpired: () => void this.mutateFromWidget(el, ctx, clearExpired),
        onClearAll: () => void this.mutateFromWidget(el, ctx, clearAll),
        onRemoveMarker: (index, label) =>
          new ConfirmModal(this.app, `Remove "${label}"?`, () =>
            void this.mutateFromWidget(el, ctx, removeMarker(index)),
          ).open(),
        onRenameMarker: (index, name) =>
          void this.mutateFromWidget(el, ctx, renameMarker(index, name)),
        onPause: (index) => void this.mutateFromWidget(el, ctx, pauseMarker(index)),
        onResume: (index) => void this.mutateFromWidget(el, ctx, resumeMarker(index)),
        onSetRemaining: (index, turns) =>
          void this.mutateFromWidget(el, ctx, setRemaining(index, turns)),
        onCopyState: () => void this.copyState(result.state),
        onAddNote: (at) =>
          new NoteModal(this.app, "", (text) => void this.mutateFromWidget(el, ctx, addNote(text, at))).open(),
        onEditNote: (index, text) =>
          new NoteModal(this.app, text, (next) =>
            void this.mutateFromWidget(el, ctx, editNote(index, next)),
          ).open(),
        onDeleteNote: (index) =>
          new ConfirmModal(this.app, "Delete this note?", () =>
            void this.mutateFromWidget(el, ctx, removeNote(index)),
          ).open(),
      }, makeFantasyDayHeader(result.state, () => this.warnCalendar()),
      (host, text) => void MarkdownRenderer.render(this.app, text, host, ctx.sourcePath, renderChild));
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

/** Prompts for a note's free-form text (empty = new note, otherwise editing), then invokes `onSubmit`. */
class NoteModal extends Modal {
  private text: string;

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
    input.addEventListener("input", () => (this.text = input.value));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Save").setCta().onClick(() => this.submit()),
    );
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    const text = this.text.trim();
    if (!text) {
      new Notice("Enter some text.");
      return;
    }
    this.onSubmit(text);
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
      });
      const suggest = new EffectLabelSuggest(this.app, t.inputEl, this.history.labels);
      suggest.onSelect((label) => {
        t.setValue(label);
        this.label = label;
        fillDuration(label);
        suggest.close();
      });
    });
    new Setting(this.contentEl).setName("Duration").addText((t) => {
      durationField = t;
      t.setPlaceholder("e.g. 6 or 2d6+1").setValue(this.duration).onChange((v) => {
        this.duration = v;
        durationTouched = true;
      });
    });
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText("Add").setCta().onClick(() => this.submit()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private submit(): void {
    // Accept a plain number or dice (e.g. "2d6+1"); dice roll now, so the effect gets a fixed span.
    const roll = rollDuration(this.duration);
    if (!this.label || !roll || roll.total < 1) {
      new Notice("Enter a label and a duration ≥ 1 turn — a number or dice like 2d6+1.");
      return;
    }
    if (roll.rolled) new Notice(`Rolled ${roll.expr}: ${roll.total} turn(s).`);
    this.onSubmit(this.label, roll.total, roll.expr);
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

    new Setting(containerEl).setName("Presets").setHeading();

    s.presets.forEach((preset, i) => {
      const row = new Setting(containerEl);
      row.settingEl.addClass("osr-tt-preset-row");
      // Each field carries its own inline label, so the row reads on its own without a header row.
      const label = (text: string) => row.controlEl.createSpan({ cls: "osr-tt-field-label", text });

      label("Name");
      row.addText((t) => {
        t.inputEl.addClass("osr-tt-preset-label");
        t.setValue(preset.label).onChange(async (v) => {
          preset.label = v;
          await this.plugin.saveSettings();
        });
      });

      label("Icon");
      // Live preview: renders the typed Lucide icon, so an invalid name shows as an empty box.
      const iconPreview = createSpan({ cls: "osr-tt-preset-icon-preview" });
      const renderPreview = (name: string) => {
        iconPreview.empty();
        if (name) setIcon(iconPreview, name);
      };
      row.addText((t) => {
        t.inputEl.addClass("osr-tt-preset-icon");
        t.setPlaceholder(PRESET_FALLBACK_ICON).setValue(preset.icon ?? "").onChange(async (v) => {
          const icon = v.trim();
          if (icon) preset.icon = icon;
          else delete preset.icon;
          renderPreview(icon);
          await this.plugin.saveSettings();
        });
      });
      row.controlEl.appendChild(iconPreview);
      renderPreview(preset.icon ?? "");

      label("Turns");
      row.addText((t) => {
        t.inputEl.addClass("osr-tt-preset-turns");
        this.numberInput(t, 1, () => preset.turns, (n) => (preset.turns = n));
      });

      label("Pausable");
      row.addToggle((t) =>
        t.setValue(preset.pausable ?? false).onChange(async (v) => {
          preset.pausable = v;
          await this.plugin.saveSettings();
        }),
      );

      row.addExtraButton((b) =>
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
          icon: PRESET_FALLBACK_ICON,
          turns: 6,
          pausable: true,
        });
        await this.plugin.saveSettings();
        this.display();
      }),
    );

    new Setting(containerEl)
      .setName("Effect history")
      .setDesc("Custom-effect labels learned for autocomplete and duration pre-fill.")
      .setHeading();

    const history = this.plugin.effectHistoryView();
    if (history.length === 0) {
      new Setting(containerEl).setDesc("No custom effects recorded yet.");
    } else {
      for (const entry of history) {
        const durations = entry.durations
          .map(([expr, count]) => (count > 1 ? `${expr} (×${count})` : expr))
          .join(", ");
        new Setting(containerEl)
          .setName(entry.label)
          .setDesc(`Used ${entry.count}× · ${durations}`)
          .addExtraButton((b) =>
            b.setIcon("trash").setTooltip("Forget").onClick(async () => {
              await this.plugin.forgetEffect(entry.label);
              this.display();
            }),
          );
      }
    }
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
