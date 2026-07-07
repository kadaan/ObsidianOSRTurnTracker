import { parseTrackerState } from "./parse";
import { serializeTrackerState } from "./serialize";
import { BlockRange, extractCodeBlockBody, replaceCodeBlockBody } from "./block";
import { Failure, Transform } from "./model";

export type ApplyResult = { ok: true; newText: string } | Failure;

/**
 * Apply a state transform to the tracker block at `range` within `fileText`:
 * parse the block body, transform, reserialize canonically, and splice it back.
 * Pure — returns the new file text (or the parse error) without touching disk.
 */
export function applyTrackerAction(
  fileText: string,
  range: BlockRange,
  transform: Transform,
): ApplyResult {
  const parsed = parseTrackerState(extractCodeBlockBody(fileText, range));
  if (!parsed.ok) return parsed;

  const newBody = serializeTrackerState(transform(parsed.state));
  return { ok: true, newText: replaceCodeBlockBody(fileText, range.lineStart, range.lineEnd, newBody) };
}
