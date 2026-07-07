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
  renameMarker,
  setRemaining,
  pauseMarker,
  resumeMarker,
} from "./actions";
import { TrackerState } from "./model";

describe("endTurn", () => {
  it("advances position by one turn, leaving other fields intact", () => {
    const before: TrackerState = {
      calendar: "Greyhawk",
      position: 14,
      lights: [{ preset: "torch", duration: 6 }],
      effects: [],
    };

    const after = endTurn(before);

    expect(after.position).toBe(15);
    expect(after.calendar).toBe("Greyhawk");
    expect(after.lights).toEqual([{ preset: "torch", duration: 6 }]);
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
  it("appends a light starting at the current position with the given duration", () => {
    const before: TrackerState = { position: 10, lights: [], effects: [] };

    expect(lightSource("torch", 6)(before).lights).toEqual([
      { preset: "torch", startsAt: 10, duration: 6 },
    ]);
  });

  it("keeps existing lights", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "lantern", duration: 24 }],
      effects: [],
    };

    expect(lightSource("torch", 6)(before).lights).toHaveLength(2);
  });
});

describe("addEffect", () => {
  it("appends an effect starting at the current position with the given duration", () => {
    const before: TrackerState = { position: 10, lights: [], effects: [] };

    expect(addEffect("Poison", 3)(before).effects).toEqual([
      { label: "Poison", startsAt: 10, duration: 3 },
    ]);
  });
});

describe("clearExpired", () => {
  it("removes markers whose burn is spent, keeping active ones", () => {
    const before: TrackerState = {
      position: 10,
      lights: [
        { preset: "torch", duration: 6 }, // expired (burns turns 0-6)
        { preset: "lantern", duration: 20 }, // active
      ],
      effects: [
        { label: "Pn", duration: 10 }, // expired (burns turns 0-10)
        { label: "Web", duration: 15 }, // active
      ],
    };

    const after = clearExpired(before);

    expect(after.lights).toEqual([{ preset: "lantern", duration: 20 }]);
    expect(after.effects).toEqual([{ label: "Web", duration: 15 }]);
  });

  it("keeps a paused marker even when its scheduled expiry is behind the position", () => {
    const before: TrackerState = {
      position: 10,
      lights: [{ preset: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3 }] }],
      effects: [],
    };

    expect(clearExpired(before).lights).toHaveLength(1);
  });
});

describe("removeMarker", () => {
  it("removes the light at the given index", () => {
    const before: TrackerState = {
      position: 0,
      lights: [
        { preset: "torch", startsAt: 0, duration: 6 },
        { preset: "lantern", startsAt: 0, duration: 24 },
      ],
      effects: [],
    };

    expect(removeMarker("light", 0)(before).lights).toEqual([
      { preset: "lantern", startsAt: 0, duration: 24 },
    ]);
  });

  it("removes the effect at the given index", () => {
    const before: TrackerState = {
      position: 0,
      lights: [],
      effects: [{ label: "Pn", startsAt: 0, duration: 4 }],
    };

    expect(removeMarker("effect", 0)(before).effects).toEqual([]);
  });

  it("targets the exact instance among identical markers, leaving the rest", () => {
    // Three identical torches: removing index 1 must leave the other two, untouched.
    const before: TrackerState = {
      position: 288,
      lights: [
        { preset: "torch", startsAt: 288, duration: 6 },
        { preset: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
        { preset: "torch", startsAt: 288, duration: 6 },
      ],
      effects: [],
    };

    expect(removeMarker("light", 1)(before).lights).toEqual([
      { preset: "torch", startsAt: 288, duration: 6 },
      { preset: "torch", startsAt: 288, duration: 6 },
    ]);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", startsAt: 0, duration: 6 }],
      effects: [],
    };

    expect(removeMarker("light", 5)(before)).toBe(before);
  });
});

describe("renameMarker", () => {
  it("sets a custom label on the light at the given index, keeping its preset", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", startsAt: 0, duration: 6 }],
      effects: [],
    };

    expect(renameMarker("light", 0, "Aragorn's torch")(before).lights).toEqual([
      { preset: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 },
    ]);
  });

  it("clears a light's custom label back to the preset default when the name is blank", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 }],
      effects: [],
    };

    expect(renameMarker("light", 0, "  ")(before).lights).toEqual([
      { preset: "torch", startsAt: 0, duration: 6 },
    ]);
  });

  it("renames the exact instance among identical markers, leaving already-labelled ones alone", () => {
    // Reproduces the reported bug: renaming a plain torch must not touch "Torch - A".
    const before: TrackerState = {
      position: 288,
      lights: [
        { preset: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
        { preset: "torch", startsAt: 288, duration: 6 },
        { preset: "torch", startsAt: 288, duration: 6 },
      ],
      effects: [],
    };

    const after = renameMarker("light", 1, "Torch - B")(before);

    expect(after.lights).toEqual([
      { preset: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
      { preset: "torch", label: "Torch - B", startsAt: 288, duration: 6 },
      { preset: "torch", startsAt: 288, duration: 6 },
    ]);
  });

  it("renames the effect at the given index", () => {
    const before: TrackerState = {
      position: 0,
      lights: [],
      effects: [{ label: "Web", startsAt: 0, duration: 12 }],
    };

    expect(renameMarker("effect", 0, "Giant Web")(before).effects).toEqual([
      { label: "Giant Web", startsAt: 0, duration: 12 },
    ]);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = {
      position: 0,
      lights: [{ preset: "torch", startsAt: 0, duration: 6 }],
      effects: [],
    };

    expect(renameMarker("light", 5, "x")(before)).toBe(before);
  });
});

describe("setRemaining", () => {
  it("adjusts duration so the marker has the given turns left, preserving consumed", () => {
    const before: TrackerState = {
      position: 12,
      lights: [{ preset: "torch", startsAt: 10, duration: 6 }], // consumed 2, remaining 4
      effects: [],
    };

    expect(setRemaining("light", 0, 10)(before).lights[0].duration).toBe(12); // 2 + 10
  });

  it("sets the duration directly for a freshly-created marker (nothing consumed yet)", () => {
    const before: TrackerState = {
      position: 10,
      lights: [{ preset: "torch", startsAt: 10, duration: 6 }],
      effects: [],
    };

    expect(setRemaining("light", 0, 3)(before).lights[0].duration).toBe(3);
  });

  it("keeps a paused marker's consumed burn frozen when setting remaining", () => {
    const before: TrackerState = {
      position: 20,
      lights: [{ preset: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3 }] }], // consumed 3
      effects: [],
    };

    expect(setRemaining("light", 0, 5)(before).lights[0].duration).toBe(8); // 3 + 5
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, lights: [], effects: [] };

    expect(setRemaining("light", 0, 5)(before)).toBe(before);
  });
});

describe("pauseMarker", () => {
  it("records a pause at the current position on the light at the given index", () => {
    const before: TrackerState = {
      position: 291,
      lights: [{ preset: "torch", startsAt: 288, duration: 6 }],
      effects: [],
    };

    expect(pauseMarker("light", 0)(before).lights[0].pauses).toEqual([{ at: 291 }]);
  });

  it("is a no-op when the marker is already paused", () => {
    const before: TrackerState = {
      position: 291,
      lights: [{ preset: "torch", startsAt: 288, duration: 6, pauses: [{ at: 290 }] }],
      effects: [],
    };

    expect(pauseMarker("light", 0)(before)).toBe(before);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, lights: [], effects: [] };

    expect(pauseMarker("light", 0)(before)).toBe(before);
  });
});

describe("resumeMarker", () => {
  it("closes the open pause at the current position", () => {
    const before: TrackerState = {
      position: 300,
      lights: [{ preset: "torch", startsAt: 288, duration: 6, pauses: [{ at: 291 }] }],
      effects: [],
    };

    expect(resumeMarker("light", 0)(before).lights[0].pauses).toEqual([{ at: 291, until: 300 }]);
  });

  it("is a no-op when the marker is not paused", () => {
    const before: TrackerState = {
      position: 300,
      lights: [{ preset: "torch", startsAt: 288, duration: 6 }],
      effects: [],
    };

    expect(resumeMarker("light", 0)(before)).toBe(before);
  });
});

describe("clearAll", () => {
  it("empties both marker lists, leaving position untouched", () => {
    const before: TrackerState = {
      position: 5,
      lights: [{ preset: "torch", duration: 11 }],
      effects: [{ label: "Pn", duration: 8 }],
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
