import { BlockRange, extractCodeBlockBody, replaceCodeBlockBody } from "./block";
import { BlockCodec } from "./tool";

export type ApplyResult<S> =
  | { ok: true; newText: string; before: S; after: S }
  | { ok: false; error: string };

/**
 * Apply a state transform to the block at `range` within `fileText` using `codec`:
 * parse the block body, transform, reserialize canonically, and splice it back.
 * Pure — returns the new file text and the before/after states (for side effects
 * like Calendarium sync) without touching disk. Tool-agnostic: the codec is the
 * only thing that knows the block's schema.
 */
export function applyAction<S>(
  fileText: string,
  range: BlockRange,
  codec: BlockCodec<S>,
  transform: (state: S) => S,
): ApplyResult<S> {
  const parsed = codec.parse(extractCodeBlockBody(fileText, range));
  if (!parsed.ok) return parsed;

  const before = parsed.state;
  const after = transform(before);
  const newBody = codec.serialize(after);
  return {
    ok: true,
    newText: replaceCodeBlockBody(fileText, range.lineStart, range.lineEnd, newBody),
    before,
    after,
  };
}
