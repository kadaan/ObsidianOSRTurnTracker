/**
 * Replace the body of a fenced code block, preserving its fences and everything
 * around it (including other code blocks). `lineStart`/`lineEnd` are the 0-indexed
 * line numbers of the opening and closing fences, as given by Obsidian's
 * `MarkdownPostProcessorContext.getSectionInfo`.
 */
import { TRACKER_LANG } from "./model";

export interface BlockRange {
  /** 0-indexed line of the opening fence. */
  lineStart: number;
  /** 0-indexed line of the closing fence. */
  lineEnd: number;
}

/** A fence line (trimmed) that opens a `turn-tracker` block. Shared with the editor autocomplete. */
export const OPEN_FENCE = new RegExp(`^\`{3,}\\s*${TRACKER_LANG}\\s*$`);
const CLOSE_FENCE = /^`{3,}\s*$/;

/** All `turn-tracker` fenced blocks in the text, as fence line ranges. */
function findTrackerBlocks(text: string): BlockRange[] {
  const lines = text.split("\n");
  const blocks: BlockRange[] = [];
  let open: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (open === null) {
      if (OPEN_FENCE.test(line)) open = i;
    } else if (CLOSE_FENCE.test(line)) {
      blocks.push({ lineStart: open, lineEnd: i });
      open = null;
    }
  }
  return blocks;
}

/**
 * Locate the `turn-tracker` block a command should act on: the block containing
 * `cursorLine`, or the sole block if the cursor is outside one. Returns null when
 * there is no unambiguous target.
 */
export function findTrackerBlockAt(text: string, cursorLine: number): BlockRange | null {
  const blocks = findTrackerBlocks(text);
  const containing = blocks.find((b) => cursorLine >= b.lineStart && cursorLine <= b.lineEnd);
  if (containing) return containing;
  return blocks.length === 1 ? blocks[0] : null;
}

export function replaceCodeBlockBody(
  fileText: string,
  lineStart: number,
  lineEnd: number,
  newBody: string,
): string {
  const lines = fileText.split("\n");
  const before = lines.slice(0, lineStart + 1); // through opening fence
  const after = lines.slice(lineEnd); // from closing fence onward
  return [...before, ...newBody.split("\n"), ...after].join("\n");
}

/** The block body: the lines strictly between the fences of `range`. */
export function extractCodeBlockBody(fileText: string, range: BlockRange): string {
  return fileText.split("\n").slice(range.lineStart + 1, range.lineEnd).join("\n");
}
