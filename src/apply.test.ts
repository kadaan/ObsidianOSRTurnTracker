import { describe, it, expect } from "vitest";
import { applyTrackerAction } from "./apply";
import { endTurn } from "./actions";

describe("applyTrackerAction", () => {
  it("applies End Turn: increments position in the block, preserving surrounding text", () => {
    const file = ["intro", "```turn-tracker", "position: 14", "```", "outro"].join("\n");

    const result = applyTrackerAction(file, { lineStart: 1, lineEnd: 3 }, endTurn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newText).toContain("position: 15");
    expect(result.newText).not.toContain("position: 14");
    expect(result.newText.startsWith("intro\n")).toBe(true);
    expect(result.newText.trimEnd().endsWith("outro")).toBe(true);
    expect(result.before.position).toBe(14);
    expect(result.after.position).toBe(15);
  });

  it("reports the parse error instead of writing when the block is malformed", () => {
    const file = ["```turn-tracker", "position: -1", "```"].join("\n");

    const result = applyTrackerAction(file, { lineStart: 0, lineEnd: 2 }, endTurn);

    expect(result.ok).toBe(false);
  });
});
