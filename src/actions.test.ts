import { describe, it, expect } from "vitest";
import { endTurn, advanceHours, toggleAt, lightSource } from "./actions";
import { TrackerState } from "./model";

describe("endTurn", () => {
  it("advances position by one turn, leaving other fields intact", () => {
    const before: TrackerState = {
      calendar: "Greyhawk",
      position: 14,
      lights: [{ preset: "torch", expiresAt: 20 }],
      effects: [],
    };

    const after = endTurn(before);

    expect(after.position).toBe(15);
    expect(after.calendar).toBe("Greyhawk");
    expect(after.lights).toEqual([{ preset: "torch", expiresAt: 20 }]);
  });
});

describe("toggleAt", () => {
  const at = (position: number): TrackerState => ({ position, lights: [], effects: [] });

  it("fills through a clicked empty box (box and all before it)", () => {
    // position 6 → click empty box 8 → boxes 0..8 filled → position 9
    expect(toggleAt(8)(at(6)).position).toBe(9);
  });

  it("empties from a clicked filled box (box and all after it)", () => {
    // position 6 → click filled box 3 → boxes 0..2 filled → position 3
    expect(toggleAt(3)(at(6)).position).toBe(3);
  });

  it("clears to zero when the first filled box is clicked", () => {
    expect(toggleAt(0)(at(6)).position).toBe(0);
  });
});

describe("lightSource", () => {
  it("appends a light expiring `turns` ahead of the current position", () => {
    const before: TrackerState = { position: 10, lights: [], effects: [] };

    expect(lightSource("torch", 6)(before).lights).toEqual([{ preset: "torch", expiresAt: 16 }]);
  });

  it("keeps existing lights", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "lantern", expiresAt: 24 }],
      effects: [],
    };

    expect(lightSource("torch", 6)(before).lights).toHaveLength(2);
  });
});

describe("advanceHours", () => {
  const base: TrackerState = { position: 10, lights: [], effects: [] };

  it("advances position by hours × 6 turns", () => {
    expect(advanceHours(1)(base).position).toBe(16);
    expect(advanceHours(3)(base).position).toBe(28);
    expect(advanceHours(8)(base).position).toBe(58);
  });
});
