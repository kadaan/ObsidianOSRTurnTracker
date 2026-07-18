import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { clamp } from "../../core/validate";
import { isValidDuration, rollDuration } from "../../dice";
import { ChargeItem, MAX_CHARGES } from "./model";

/**
 * Modal to add a charged item: a name and a max charge count — a plain number or a dice expression
 * (e.g. "2d6+1"), rolled on submit like the turn tracker's durations. The new item starts full.
 */
export class AddChargeItemModal extends Modal {
  private name = "";
  private charges = "6";
  private saveButton?: ButtonComponent;

  constructor(
    app: App,
    private readonly onSubmit: (item: ChargeItem) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.addClass("osr-charge-add-modal"); // scope the wider-input styling
    this.contentEl.createEl("h3", { text: "Add item" }); // in-content title, like the add-effect modal

    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Wand of Fireballs").onChange((v) => {
        this.name = v.trim();
        this.refresh();
      });
      window.setTimeout(() => t.inputEl.focus());
    });

    new Setting(this.contentEl)
      .setName("Charges")
      .setDesc("Maximum charges — a number or dice (e.g. 2d6+1).\nThe item starts full.")
      .addText((t) =>
        t
          .setPlaceholder("6")
          .setValue(this.charges)
          .onChange((v) => {
            this.charges = v;
            this.refresh();
          }),
      );

    new Setting(this.contentEl).addButton((b) => {
      this.saveButton = b;
      b.setButtonText("Add")
        .setCta()
        .onClick(() => this.submit());
    });

    // Cmd/Ctrl+Enter adds, matching the Add button's enabled state (like the effect dialog).
    this.scope.register(["Mod"], "Enter", () => {
      if (this.isValid()) this.submit();
      return false;
    });

    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private isValid(): boolean {
    return this.name.length > 0 && isValidDuration(this.charges);
  }

  private refresh(): void {
    this.saveButton?.setDisabled(!this.isValid());
  }

  private submit(): void {
    if (!this.isValid()) return;
    const roll = rollDuration(this.charges);
    if (!roll) return;
    // A dice roll can land ≤ 0 (big negative modifier) or above the render cap — clamp to a usable max.
    const max = clamp(roll.total, 1, MAX_CHARGES);
    if (roll.rolled) new Notice(`Rolled ${roll.expr}: ${max} charge${max === 1 ? "" : "s"}.`);
    this.onSubmit({ name: this.name, current: max, max });
    this.close();
  }
}
