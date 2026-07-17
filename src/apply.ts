import { parseTrackerState } from "./parse";
import { serializeTrackerState } from "./serialize";
import { BlockRange } from "./block";
import { TrackerState, Transform } from "./model";
import { applyAction, ApplyResult as CoreApplyResult } from "./core/apply";
import { BlockCodec } from "./core/tool";

/** The turn tracker's block schema as a codec — its parse/serialize pair for the shared pipeline. */
export const trackerCodec: BlockCodec<TrackerState> = {
  parse: parseTrackerState,
  serialize: serializeTrackerState,
};

export type ApplyResult = CoreApplyResult<TrackerState>;

/**
 * Apply a state transform to the tracker block at `range` within `fileText`.
 * Thin turn-tracker binding of the tool-agnostic `applyAction`.
 */
export function applyTrackerAction(
  fileText: string,
  range: BlockRange,
  transform: Transform,
): ApplyResult {
  return applyAction(fileText, range, trackerCodec, transform);
}
