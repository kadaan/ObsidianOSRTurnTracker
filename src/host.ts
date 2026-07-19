/** Host-integration types shared by the plugin host (main.ts) and the tools it registers. These
 *  live here, not in `core/`, because they reference Obsidian types — `core/` stays Obsidian-free. */

import { App, Editor, MarkdownView, TFile } from "obsidian";
import { BlockRange, findBlocks } from "./core/block";
import { BlockCodec, ToolModule } from "./core/tool";

/** The write funnel a tool needs from the host: locate → transform → persist a block of its state.
 *  The host owns the single implementation (with the re-entrancy guard); each tool's host extends
 *  this with whatever else that tool needs. */
export interface WriteHost<S> {
  app: App;
  applyToFile(
    file: TFile,
    sourceText: string,
    range: BlockRange,
    codec: BlockCodec<S>,
    transform: (state: S) => S,
    afterWrite?: (before: S, after: S) => void,
  ): Promise<void>;
}

/** A command's resolved target: the active note's file, its current text, and the block to act on. */
export interface CommandTarget {
  file: TFile;
  text: string;
  range: BlockRange;
}

/** The unambiguous block a command should act on in the active note: the block at the cursor (in an
 *  editing view) or the note's sole block; null when there's no active note, no block of `lang`, or
 *  several blocks with no cursor to disambiguate. Uses the view's data, so it works in reading and
 *  editing views alike. */
export function resolveCommandTarget(app: App, lang: string): CommandTarget | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view?.file) return null;
  const text = view.getViewData();
  const blocks = findBlocks(text, lang);
  if (blocks.length === 0) return null;
  let range: BlockRange | undefined;
  if (view.getMode() === "source") {
    // Source / live-preview: the cursor picks the block, so multiple trackers are unambiguous.
    const line = view.editor.getCursor().line;
    range = blocks.find((b) => line >= b.lineStart && line <= b.lineEnd);
  }
  range ??= blocks.length === 1 ? blocks[0] : undefined; // reading view, or cursor outside a block
  return range ? { file: view.file, text, range } : null;
}

/** A command `checkCallback` that lists the command — in any view mode — only when exactly one target
 *  block is resolvable, then runs `perform` on it. Ambiguous (multiple blocks, no cursor) or absent
 *  targets simply hide the command from the palette. */
export function blockCommand(
  app: App,
  lang: string,
  perform: (target: CommandTarget) => void,
): (checking: boolean) => boolean {
  return (checking) => {
    const target = resolveCommandTarget(app, lang);
    if (!target) return false;
    if (!checking) perform(target);
    return true;
  };
}

/** A command a tool contributes. `id` is already tool-namespaced; the host registers it. Set exactly
 *  one action: `editorCallback` (listed only while editing — for actions that need the cursor, like
 *  inserting a new block) or `checkCallback` (listed in any mode when its target is unambiguous —
 *  built via `blockCommand`). */
export interface ToolCommand {
  id: string;
  name: string;
  editorCallback?: (editor: Editor) => void;
  checkCallback?: (checking: boolean) => boolean;
}

/**
 * A tool as the plugin host sees it: the portable `ToolModule` plus the Obsidian-integration hooks
 * (editor commands, a settings section).
 */
export interface PluginTool<S> extends ToolModule<S> {
  commands?(): ToolCommand[];
  /** Render this tool's settings into the shared settings tab (the host owns only the shell). */
  settingsSection?(containerEl: HTMLElement): void;
}
