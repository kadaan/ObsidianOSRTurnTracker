/**
 * Turn-tracker-flavored view of the tool-agnostic block helpers in `core/block`.
 * The generic find/splice logic lives in `core/`; this module binds it to the
 * `turn-tracker` language for the tracker's own callers and autocomplete.
 */
import { TRACKER_LANG } from "./model";
import { BlockRange, findBlockAt, openFence } from "../../core/block";

export type { BlockRange } from "../../core/block";
export { extractCodeBlockBody, replaceCodeBlockBody } from "../../core/block";

/** A fence line (trimmed) that opens a `turn-tracker` block. Shared with the editor autocomplete. */
export const OPEN_FENCE = openFence(TRACKER_LANG);

/** `findBlockAt` bound to the `turn-tracker` language. */
export function findTrackerBlockAt(text: string, cursorLine: number): BlockRange | null {
  return findBlockAt(text, cursorLine, TRACKER_LANG);
}
