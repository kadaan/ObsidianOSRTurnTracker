import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { clamp } from "../../core/validate";
import { isValidDuration, rollDuration } from "../../core/dice";
import { ChargeItem, MAX_CHARGES } from "./model";

/** Roll a charges expression (a number or dice) and clamp it into [min, max], notifying the rolled
 *  result. Returns null for an unparseable expression (guarded by the disabled button; defensive). */
function rollCharges(value: string, min: number, max: number): number | null {
  const roll = rollDuration(value);
  if (!roll) return null;
  const charges = clamp(roll.total, min, max);
  if (roll.rolled) new Notice(`Rolled ${roll.expr}: ${charges} charge${charges === 1 ? "" : "s"}.`);
  return charges;
}

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
    this.contentEl.addClass("osr-charge-modal"); // scope the wider-input styling
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
    // A dice roll can land ≤ 0 (big negative modifier) or above the render cap — clamp to a usable max.
    const max = rollCharges(this.charges, 1, MAX_CHARGES);
    if (max === null) return;
    this.onSubmit({ name: this.name, current: max, max });
    this.close();
  }
}

/**
 * Modal to recharge an item: add charges to its current (a number or dice, e.g. "1d6+1"), and
 * optionally change its max — the max field pre-fills with the item's current max. Both are rolled
 * on submit; the recharge amount is optional (blank just applies the max). `onSubmit` gets the amount
 * to add and the new max, which the `recharge` action applies (capping current at the new max).
 */
export class RechargeItemModal extends Modal {
  private add = "";
  private max: string;
  private saveButton?: ButtonComponent;

  constructor(
    app: App,
    private readonly item: ChargeItem,
    private readonly onSubmit: (amount: number, max: number) => void,
  ) {
    super(app);
    this.max = String(item.max);
  }

  onOpen(): void {
    this.contentEl.addClass("osr-charge-modal"); // scope the wider-input styling
    this.contentEl.createEl("h3", { text: `Recharge ${this.item.name}` });

    new Setting(this.contentEl)
      .setName("Recharge by")
      .setDesc("Charges to add — a number or dice (e.g. 1d6+1). Leave blank to only change the max.")
      .addText((t) => {
        t.setPlaceholder("e.g. 1d6").onChange((v) => {
          this.add = v;
          this.refresh();
        });
        window.setTimeout(() => t.inputEl.focus());
      });

    new Setting(this.contentEl)
      .setName("Max")
      .setDesc("Maximum charges — a number or dice.")
      .addText((t) =>
        t.setValue(this.max).onChange((v) => {
          this.max = v;
          this.refresh();
        }),
      );

    new Setting(this.contentEl).addButton((b) => {
      this.saveButton = b;
      b.setButtonText("Recharge")
        .setCta()
        .onClick(() => this.submit());
    });

    this.scope.register(["Mod"], "Enter", () => {
      if (this.isValid()) this.submit();
      return false;
    });

    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** The max must parse; the recharge amount is optional (blank = add nothing). */
  private isValid(): boolean {
    return isValidDuration(this.max) && (this.add.trim() === "" || isValidDuration(this.add));
  }

  private refresh(): void {
    this.saveButton?.setDisabled(!this.isValid());
  }

  private submit(): void {
    if (!this.isValid()) return;
    const max = rollCharges(this.max, 1, MAX_CHARGES);
    if (max === null) return;
    let amount = 0;
    if (this.add.trim() !== "") {
      const roll = rollDuration(this.add);
      if (!roll) return;
      amount = roll.total;
      if (roll.rolled) new Notice(`Rolled ${roll.expr}: +${amount} charge${amount === 1 ? "" : "s"}.`);
    }
    this.onSubmit(amount, max);
    this.close();
  }
}
