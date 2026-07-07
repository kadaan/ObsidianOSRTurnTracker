import { describe, it, expect } from "vitest";
import {
  endTurn,
  advanceHours,
  toggleAt,
  lightSource,
  addEffect,
  clearExpired,
  clearAll,
  removeMarker,
} from "./actions";
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

describe("addEffect", () => {
  it("appends an effect expiring `turns` ahead of the current position", () => {
    const before: TrackerState = { position: 10, lights: [], effects: [] };

    expect(addEffect("Poison", 3)(before).effects).toEqual([{ label: "Poison", expiresAt: 13 }]);
  });
});

describe("clearExpired", () => {
  it("removes lights and effects at/behind position, keeping active ones", () => {
    const before: TrackerState = {
      position: 10,
      lights: [
        { preset: "torch", expiresAt: 6 }, // expired (6 <= 10)
        { preset: "lantern", expiresAt: 20 }, // active
      ],
      effects: [
        { label: "Pn", expiresAt: 10 }, // expired (10 <= 10)
        { label: "Web", expiresAt: 15 }, // active
      ],
    };

    const after = clearExpired(before);

    expect(after.lights).toEqual([{ preset: "lantern", expiresAt: 20 }]);
    expect(after.effects).toEqual([{ label: "Web", expiresAt: 15 }]);
  });
});

describe("removeMarker", () => {
  it("removes exactly one matching light, decrementing a stack", () => {
    const before: TrackerState = {
      position: 0,
      lights: [
        { preset: "torch", expiresAt: 6 },
        { preset: "torch", expiresAt: 6 },
      ],
      effects: [],
    };

    expect(removeMarker("light", "torch", 6)(before).lights).toEqual([
      { preset: "torch", expiresAt: 6 },
    ]);
  });

  it("removes a matching effect", () => {
    const before: TrackerState = {
      position: 0,
      lights: [],
      effects: [{ label: "Pn", expiresAt: 4 }],
    };

    expect(removeMarker("effect", "Pn", 4)(before).effects).toEqual([]);
  });

  it("disambiguates a light from an effect that share a glyph on the same turn", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", expiresAt: 6 }], // glyph "T"
      effects: [{ label: "T", expiresAt: 6 }], // literally labelled "T"
    };

    const afterEffect = removeMarker("effect", "T", 6)(before);
    expect(afterEffect.lights).toEqual([{ preset: "torch", expiresAt: 6 }]); // torch untouched
    expect(afterEffect.effects).toEqual([]); // only the effect removed
  });

  it("leaves state unchanged when nothing matches", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", expiresAt: 6 }],
      effects: [],
    };

    expect(removeMarker("light", "lantern", 6)(before)).toBe(before);
  });
});

describe("clearAll", () => {
  it("empties both marker lists, leaving position untouched", () => {
    const before: TrackerState = {
      position: 5,
      lights: [{ preset: "torch", expiresAt: 11 }],
      effects: [{ label: "Pn", expiresAt: 8 }],
    };

    const after = clearAll(before);

    expect(after.lights).toEqual([]);
    expect(after.effects).toEqual([]);
    expect(after.position).toBe(5);
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
