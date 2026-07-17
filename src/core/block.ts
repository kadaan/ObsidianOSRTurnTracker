/**
 * Tool-agnostic code-block location and splicing. Every tool's fenced block is
 * found, extracted, and rewritten through these helpers, parameterized only by the
 * fence language. `lineStart`/`lineEnd` are the 0-indexed lines of the opening and
 * closing fences, as given by Obsidian's `getSectionInfo`.
 */

export interface BlockRange {
  /** 0-indexed line of the opening fence. */
  lineStart: number;
  /** 0-indexed line of the closing fence. */
  lineEnd: number;
}

/** A fence line (trimmed) that opens a block of `lang`. Also used by editor autocomplete. */
export const openFence = (lang: string): RegExp => new RegExp(`^\`{3,}\\s*${lang}\\s*$`);
const CLOSE_FENCE = /^`{3,}\s*$/;

/** All fenced blocks of `lang` in the text, as fence line ranges. */
export function findBlocks(text: string, lang: string): BlockRange[] {
  const open = openFence(lang);
  const lines = text.split("\n");
  const blocks: BlockRange[] = [];
  let start: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (start === null) {
      if (open.test(line)) start = i;
    } else if (CLOSE_FENCE.test(line)) {
      blocks.push({ lineStart: start, lineEnd: i });
      start = null;
    }
  }
  return blocks;
}

/**
 * Locate the block of `lang` a command should act on: the one containing
 * `cursorLine`, or the sole block if the cursor is outside one. Returns null when
 * there is no unambiguous target.
 */
export function findBlockAt(text: string, cursorLine: number, lang: string): BlockRange | null {
  const blocks = findBlocks(text, lang);
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

/** Wrap a serialized body in a fenced code block of `lang`, ready to insert into a note. */
export function fenceBlock(lang: string, body: string): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}
