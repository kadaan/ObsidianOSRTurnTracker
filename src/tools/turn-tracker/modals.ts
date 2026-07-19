/** The turn tracker's modal dialogs and preset-id helper: add/edit a note, add an ad-hoc effect,
 *  and edit a light preset. */

import { App, AbstractInputSuggest, ButtonComponent, Modal, Notice, Setting, setIcon, TextComponent } from "obsidian";
import { isValidDuration, rollDuration } from "../../core/dice";
import { EffectHistoryView } from "./effect-history";
import { LightPreset } from "./model";

/** Prompts for a note's free-form text (empty = new note, otherwise editing), then invokes `onSubmit`. */
export class NoteModal extends Modal {
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
export class EffectModal extends Modal {
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
export function presetIdFromLabel(label: string, existingIds: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "preset";
  if (!existingIds.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
}

/** Edits a light preset's fields (name, icon, duration, pausable) in a modal, then invokes `onSubmit`. */
export class PresetModal extends Modal {
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
