import { App, Modal, Setting } from "obsidian";

/** A yes/no confirmation dialog; runs `onConfirm` only if the user confirms. Shared UI primitive. */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: () => void,
    private readonly confirmText = "Remove",
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText(this.confirmText).onClick(() => {
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
