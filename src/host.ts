/** Host-integration types shared by the plugin host (main.ts) and the tools it registers. These
 *  live here, not in `core/`, because they reference Obsidian's `Editor` — `core/` stays Obsidian-free. */

import { Editor } from "obsidian";
import { ToolModule } from "./core/tool";

/** An editor command a tool contributes. `id` is already tool-namespaced; the host registers it. */
export interface ToolCommand {
  id: string;
  name: string;
  editorCallback: (editor: Editor) => void;
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
