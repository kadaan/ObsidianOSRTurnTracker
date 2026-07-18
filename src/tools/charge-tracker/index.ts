import { App } from "obsidian";
import { ToolModule } from "../../core/tool";
import { chargeCodec } from "./codec";
import { CHARGE_LANG, ChargeTrackerState } from "./model";
import { renderChargeTracker } from "./render";

/**
 * The charge tracker as a self-contained tool module. It needs no plugin *state* (no frontmatter
 * resolution, calendar, or settings), only `app` to open its add-item modal — captured here so the
 * `core/` layer stays free of Obsidian types. Its `render` builds handlers purely from `ctx.mutate`.
 */
export function createChargeTrackerTool(app: App): ToolModule<ChargeTrackerState> {
  return {
    id: CHARGE_LANG,
    lang: CHARGE_LANG,
    displayName: "Charge tracker",
    codec: chargeCodec,
    render: (ctx) => renderChargeTracker(ctx, app),
  };
}
