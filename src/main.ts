import {
  Editor,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import { parseTrackerState } from "./parse";
import { renderError, renderTracker } from "./render";
import { endTurn } from "./actions";
import { applyTrackerAction } from "./apply";
import { BlockRange, findTrackerBlockAt } from "./block";
import { TRACKER_LANG, Transform } from "./model";

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
      });
    });

    this.addCommand({
      id: "end-turn",
      name: "End turn",
      editorCallback: (editor) => void this.mutateFromEditor(editor, endTurn),
    });
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
