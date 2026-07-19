import { describe, it, expect } from "vitest";
import { parseChargeState, serializeChargeState } from "./codec";

describe("parseChargeState", () => {
  it("parses items with name, current, and max", () => {
    const result = parseChargeState("items:\n  - { name: Wand of Fireballs, current: 5, max: 7 }");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items).toEqual([{ name: "Wand of Fireballs", current: 5, max: 7 }]);
  });

  it("rejects an unknown top-level key", () => {
    const result = parseChargeState("items: []\nbogus: 1");

    expect(result.ok).toBe(false);
  });

  it("rejects malformed items", () => {
    const bad = [
      "items: not-a-list",
      "items:\n  - { name: Wand, current: 8, max: 7 }", // current > max
      "items:\n  - { name: Wand, current: -1, max: 7 }", // negative
      "items:\n  - { name: Wand, current: 1.5, max: 7 }", // non-integer
      "items:\n  - { current: 1, max: 7 }", // missing name
      "items:\n  - { name: '', current: 1, max: 7 }", // empty name
      "items:\n  - { name: Wand, current: 0, max: 100000 }", // max beyond the render cap
    ];

    for (const src of bad) {
      expect(parseChargeState(src).ok, src).toBe(false);
    }
  });

  it("accepts a full charge (current === max) and an empty one (current 0)", () => {
    const result = parseChargeState(
      "items:\n  - { name: Wand, current: 0, max: 3 }\n  - { name: Staff, current: 7, max: 7 }",
    );

    expect(result.ok).toBe(true);
  });

  it("trims surrounding whitespace from item names", () => {
    const result = parseChargeState("items:\n  - { name: '  Wand  ', current: 1, max: 3 }");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.items[0].name).toBe("Wand");
  });
});

describe("serializeChargeState", () => {
  it("round-trips state through serialize → parse", () => {
    const state = {
      items: [
        { name: "Torch", current: 2, max: 6 },
        { name: "Wand of Fireballs", current: 0, max: 3 },
      ],
    };

    const reparsed = parseChargeState(serializeChargeState(state));

    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.state).toEqual(state);
  });

  it("round-trips an empty tracker (the block 'Create charge tracker' inserts)", () => {
    const reparsed = parseChargeState(serializeChargeState({ items: [] }));

    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.state).toEqual({ items: [] });
  });
});
