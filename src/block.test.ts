import { describe, it, expect } from "vitest";
import { replaceCodeBlockBody, findTrackerBlockAt } from "./block";

describe("replaceCodeBlockBody", () => {
  it("replaces only the fenced body at the given line range, preserving fences and other blocks", () => {
    const file = [
      "# Session",
      "Some intro.",
      "",
      "```osr-tools-turn-tracker", // line 3 — opening fence
      "position: 14", // line 4 — body
      "```", // line 5 — closing fence
      "",
      "Notes here.",
      "",
      "```dataview",
      "list",
      "```",
    ].join("\n");

    const result = replaceCodeBlockBody(file, 3, 5, "start: Day 1\nposition: 15");

    // target body replaced (multi-line)
    expect(result).toContain("start: Day 1\nposition: 15");
    expect(result).not.toContain("position: 14");
    // fences preserved
    expect(result).toContain("```osr-tools-turn-tracker\nstart: Day 1\nposition: 15\n```");
    // surrounding prose and the OTHER code block untouched
    expect(result).toContain("# Session");
    expect(result).toContain("Notes here.");
    expect(result).toContain("```dataview\nlist\n```");
  });
});

describe("findTrackerBlockAt", () => {
  it("returns the sole tracker block's fence range even when the cursor is outside it", () => {
    const text = ["# Note", "```osr-tools-turn-tracker", "position: 3", "```", "after"].join("\n");

    expect(findTrackerBlockAt(text, 0)).toEqual({ lineStart: 1, lineEnd: 3 });
  });

  it("picks the block the cursor sits inside when there are several", () => {
    const text = [
      "```osr-tools-turn-tracker", // 0
      "position: 1", // 1
      "```", // 2
      "between", // 3
      "```osr-tools-turn-tracker", // 4
      "position: 2", // 5
      "```", // 6
    ].join("\n");

    expect(findTrackerBlockAt(text, 5)).toEqual({ lineStart: 4, lineEnd: 6 });
  });

  it("returns null when the cursor is outside and the target is ambiguous", () => {
    const text = [
      "```osr-tools-turn-tracker", // 0
      "position: 1", // 1
      "```", // 2
      "between", // 3
      "```osr-tools-turn-tracker", // 4
      "position: 2", // 5
      "```", // 6
    ].join("\n");

    expect(findTrackerBlockAt(text, 3)).toBeNull();
  });
});
