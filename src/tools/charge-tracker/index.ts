import { Editor, Notice } from "obsidian";
import { fenceBlock, findBlockAt } from "../../core/block";
import { PluginTool, requireActiveEditor, ToolCommand, WriteHost } from "../../host";
import { addItem } from "./actions";
import { chargeCodec, serializeChargeState } from "./codec";
import { chargeCommandIds } from "./commands";
import { AddChargeItemModal } from "./modal";
import { CHARGE_LANG, ChargeTrackerState, ChargeTransform } from "./model";
import { renderChargeTracker } from "./render";

/** The charge tracker's host: just the shared write funnel and `app` (`WriteHost`). It is block-local,
 *  needing no settings, frontmatter, or calendar — so it adds nothing beyond the funnel. */
export type ChargeTrackerHost = WriteHost<ChargeTrackerState>;

/** The charge tracker's editor commands: create a new block, and add an item to the block at the
 *  cursor. `Create` is a plain (always-listed) command so it's reachable from the palette in any mode;
 *  `Add item` is editor-scoped to the block the cursor is in. */
function chargeCommands(host: ChargeTrackerHost): ToolCommand[] {
  // Apply a transform to the charge block at the cursor, reading the buffer fresh (so a modal's delay
  // can't act on a stale snapshot), mirroring the turn tracker's editor write path.
  const mutateFromEditor = (editor: Editor, transform: ChargeTransform): void => {
    const file = host.app.workspace.getActiveFile();
    if (!file) return;
    const text = editor.getValue();
    const range = findBlockAt(text, editor.getCursor().line, CHARGE_LANG);
    if (!range) {
      new Notice("Place the cursor in a charge-tracker block.");
      return;
    }
    void host.applyToFile(file, text, range, chargeCodec, transform);
  };

  return [
    {
      id: chargeCommandIds.create,
      name: "Insert charge tracker",
      callback: () => {
        const editor = requireActiveEditor(host.app, "insert charge tracker");
        if (!editor) return;
        editor.replaceSelection(`${fenceBlock(CHARGE_LANG, serializeChargeState({ items: [] }))}\n`);
      },
    },
    {
      id: chargeCommandIds.addItem,
      name: "Add item",
      editorCallback: (editor) =>
        new AddChargeItemModal(host.app, (item) => mutateFromEditor(editor, addItem(item))).open(),
    },
  ];
}

/**
 * The charge tracker as a self-contained tool module. Block-local — it needs no plugin *state*
 * (no frontmatter, calendar, or settings), only `app` and the shared write funnel via the host, so
 * the `core/` layer stays free of Obsidian types. Its `render` builds handlers from `ctx.mutate`.
 */
export function createChargeTrackerTool(host: ChargeTrackerHost): PluginTool<ChargeTrackerState> {
  return {
    id: CHARGE_LANG,
    lang: CHARGE_LANG,
    displayName: "Charge tracker",
    codec: chargeCodec,
    commands: () => chargeCommands(host),
    render: (ctx) => renderChargeTracker(ctx, host.app),
  };
}
