import { describe, it, expect } from "vitest";
import { findBlockAt } from "./block";

describe("findBlockAt", () => {
  it("locates a fenced block by its language, not a hardcoded one", () => {
    const text = ["# Note", "```charge-tracker", "items: []", "```", "after"].join("\n");

    expect(findBlockAt(text, 0, "charge-tracker")).toEqual({ lineStart: 1, lineEnd: 3 });
  });
});
