import { describe, it, expect } from "vitest";
import { applyAction } from "./apply";
import { BlockCodec } from "./tool";

// A throwaway codec proving the pipeline is codec-driven, not tied to any one tool.
const counterCodec: BlockCodec<{ n: number }> = {
  parse(src) {
    const m = /^n:\s*(-?\d+)\s*$/.exec(src.trim());
    return m ? { ok: true, state: { n: Number(m[1]) } } : { ok: false, error: "not a counter" };
  },
  serialize(s) {
    return `n: ${s.n}`;
  },
};

describe("applyAction", () => {
  it("parses, transforms, reserializes, and splices any codec's block back into the file", () => {
    const file = ["intro", "```counter", "n: 1", "```", "outro"].join("\n");

    const result = applyAction(file, { lineStart: 1, lineEnd: 3 }, counterCodec, (s) => ({ n: s.n + 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newText).toContain("n: 2");
    expect(result.newText).not.toContain("n: 1");
    expect(result.newText.startsWith("intro\n")).toBe(true);
    expect(result.newText.trimEnd().endsWith("outro")).toBe(true);
    expect(result.before.n).toBe(1);
    expect(result.after.n).toBe(2);
  });

  it("reports the codec's parse error instead of writing when the block is malformed", () => {
    const file = ["```counter", "nonsense", "```"].join("\n");

    const result = applyAction(file, { lineStart: 0, lineEnd: 2 }, counterCodec, (s) => s);

    expect(result.ok).toBe(false);
  });
});
