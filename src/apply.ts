import { parseTrackerState } from "./parse";
import { serializeTrackerState } from "./serialize";
import { BlockRange, extractCodeBlockBody, replaceCodeBlockBody } from "./block";
import { Failure, TrackerState, Transform } from "./model";

export type ApplyResult =
  | { ok: true; newText: string; before: TrackerState; after: TrackerState }
  | Failure;

/**
 * Apply a state transform to the tracker block at `range` within `fileText`:
 * parse the block body, transform, reserialize canonically, and splice it back.
 * Pure — returns the new file text and the before/after states (for side effects
 * like Calendarium sync) without touching disk.
 */
export function applyTrackerAction(
  fileText: string,
  range: BlockRange,
  transform: Transform,
): ApplyResult {
  const parsed = parseTrackerState(extractCodeBlockBody(fileText, range));
  if (!parsed.ok) return parsed;

  const before = parsed.state;
  const after = transform(before);
  const newBody = serializeTrackerState(after);
  return {
    ok: true,
    newText: replaceCodeBlockBody(fileText, range.lineStart, range.lineEnd, newBody),
    before,
    after,
  };
}
