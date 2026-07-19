import { fenceBlock } from "../../core/block";
import { blockCommand, CommandTarget, PluginTool, ToolCommand, WriteHost } from "../../host";
import { addItem } from "./actions";
import { chargeCodec, serializeChargeState } from "./codec";
import { chargeCommandIds } from "./commands";
import { AddChargeItemModal } from "./modal";
import { CHARGE_LANG, ChargeTrackerState, ChargeTransform } from "./model";
import { renderChargeTracker } from "./render";

/** The charge tracker's host: just the shared write funnel and `app` (`WriteHost`). It is block-local,
 *  needing no settings, frontmatter, or calendar — so it adds nothing beyond the funnel. */
export type ChargeTrackerHost = WriteHost<ChargeTrackerState>;

/** The charge tracker's commands. Insert needs a cursor to place the new block, so it's edit-only.
 *  Add item acts on an existing block, so it's a `blockCommand` — listed in any view mode, but only
 *  when its target is unambiguous (the block at the cursor, or the note's sole charge tracker). */
function chargeCommands(host: ChargeTrackerHost): ToolCommand[] {
  const applyToTarget = (target: CommandTarget, transform: ChargeTransform): void =>
    void host.applyToFile(target.file, target.text, target.range, chargeCodec, transform);

  return [
    {
      id: chargeCommandIds.create,
      name: "Insert charge tracker",
      editorCallback: (editor) =>
        editor.replaceSelection(`${fenceBlock(CHARGE_LANG, serializeChargeState({ items: [] }))}\n`),
    },
    {
      id: chargeCommandIds.addItem,
      name: "Add item",
      checkCallback: blockCommand(host.app, CHARGE_LANG, (target) =>
        new AddChargeItemModal(host.app, (item) => applyToTarget(target, addItem(item))).open(),
      ),
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
