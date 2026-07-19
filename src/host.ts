/** Host-integration types shared by the plugin host (main.ts) and the tools it registers. These
 *  live here, not in `core/`, because they reference Obsidian types — `core/` stays Obsidian-free. */

import { App, Editor, Notice, TFile } from "obsidian";
import { BlockRange } from "./core/block";
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

/** The active note's editor, or null (after a Notice) when no note is in edit mode. For entry-point
 *  `callback` commands that insert into the current note; `purpose` completes "Open a note in edit
 *  mode to …". */
export function requireActiveEditor(app: App, purpose: string): Editor | null {
  const editor = app.workspace.activeEditor?.editor;
  if (!editor) {
    new Notice(`Open a note in edit mode to ${purpose}.`);
    return null;
  }
  return editor;
}

/** A command a tool contributes. `id` is already tool-namespaced; the host registers it. Set exactly
 *  one callback: `editorCallback` (listed only while a note is being edited — for actions on the block
 *  at the cursor) or `callback` (always listed — for entry-point actions like inserting a new block). */
export interface ToolCommand {
  id: string;
  name: string;
  editorCallback?: (editor: Editor) => void;
  callback?: () => void;
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
