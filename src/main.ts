import {
  App,
  Editor,
  MarkdownPostProcessorContext,
  Modal,
  Notice,
  Plugin,
  Setting,
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
  toggleAt,
} from "./actions";
import { applyTrackerAction } from "./apply";
import { BlockRange, findTrackerBlockAt } from "./block";
import { DEFAULT_ADVANCE_SHORTCUTS, TRACKER_LANG, Transform } from "./model";

export default class OsrTurnTrackerPlugin extends Plugin {
  /** Serializes writes so rapid clicks can't race on a stale block snapshot. */
  private applying = false;

  async onload() {
    // Processors registered on the plugin are auto-detached on unload.
    this.registerMarkdownCodeBlockProcessor(TRACKER_LANG, (source, el, ctx) => {
      const result = parseTrackerState(source);
      if (!result.ok) {
        renderError(el, result.error);
        return;
      }
      renderTracker(el, result.state, {
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
        onRemoveMarker: (kind, key, expiresAt) =>
          void this.mutateFromWidget(el, ctx, removeMarker(kind, key, expiresAt)),
      });
    });

    this.addCommand({
      id: "end-turn",
      name: "End turn",
      editorCallback: (editor) => void this.mutateFromEditor(editor, endTurn),
    });

    for (const hours of DEFAULT_ADVANCE_SHORTCUTS) {
      this.addCommand({
        id: `advance-${hours}h`,
        name: `Advance ${hours} hour${hours === 1 ? "" : "s"}`,
        editorCallback: (editor) => void this.mutateFromEditor(editor, advanceHours(hours)),
      });
    }
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
