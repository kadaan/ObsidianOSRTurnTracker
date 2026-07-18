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
  addNote,
  editNote,
  removeNote,
} from "./actions";
import { TrackerState } from "./model";
import { resolveMarker } from "./markers";

describe("endTurn", () => {
  it("advances position by one turn, leaving other fields intact", () => {
    const before: TrackerState = {
      calendar: "Greyhawk",
      position: 14,
      markers: [{ type: "torch", duration: 6 }],
    };

    const after = endTurn(before);

    expect(after.position).toBe(15);
    expect(after.calendar).toBe("Greyhawk");
    expect(after.markers).toEqual([{ type: "torch", duration: 6 }]);
  });
});

describe("toggleAt", () => {
  const at = (position: number): TrackerState => ({ position, markers: [] });

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
  it("appends a preset marker starting at the current position with the given duration", () => {
    const before: TrackerState = { position: 10, markers: [] };

    expect(lightSource("torch", 6)(before).markers).toEqual([
      { type: "torch", startsAt: 10, duration: 6 },
    ]);
  });

  it("starts the marker at an explicit turn when given (e.g. placed from a timeline box)", () => {
    const before: TrackerState = { position: 10, markers: [] };

    expect(lightSource("torch", 6, 50)(before).markers).toEqual([
      { type: "torch", startsAt: 50, duration: 6 },
    ]);
  });

  it("keeps existing markers", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "lantern", duration: 24 }],
    };

    expect(lightSource("torch", 6)(before).markers).toHaveLength(2);
  });
});

describe("addEffect", () => {
  it("appends a custom marker starting at the current position with the given duration", () => {
    const before: TrackerState = { position: 10, markers: [] };

    expect(addEffect("Poison", 3)(before).markers).toEqual([
      { type: "custom", label: "Poison", startsAt: 10, duration: 3 },
    ]);
  });

  it("starts the effect at an explicit turn when given", () => {
    const before: TrackerState = { position: 10, markers: [] };

    expect(addEffect("Poison", 3, 50)(before).markers).toEqual([
      { type: "custom", label: "Poison", startsAt: 50, duration: 3 },
    ]);
  });
});

describe("clearExpired", () => {
  it("removes markers whose burn is spent, keeping active ones", () => {
    const before: TrackerState = {
      position: 10,
      markers: [
        { type: "torch", duration: 6 }, // expired (burns turns 0-6)
        { type: "lantern", duration: 20 }, // active
        { type: "custom", label: "Pn", duration: 10 }, // expired (burns turns 0-10)
        { type: "custom", label: "Web", duration: 15 }, // active
      ],
    };

    const after = clearExpired(before);

    expect(after.markers).toEqual([
      { type: "lantern", duration: 20 },
      { type: "custom", label: "Web", duration: 15 },
    ]);
  });

  it("keeps a paused marker even when its scheduled expiry is behind the position", () => {
    const before: TrackerState = {
      position: 10,
      markers: [{ type: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3 }] }],
    };

    expect(clearExpired(before).markers).toHaveLength(1);
  });
});

describe("removeMarker", () => {
  it("removes the marker at the given index", () => {
    const before: TrackerState = {
      position: 0,
      markers: [
        { type: "torch", startsAt: 0, duration: 6 },
        { type: "lantern", startsAt: 0, duration: 24 },
      ],
    };

    expect(removeMarker(0)(before).markers).toEqual([
      { type: "lantern", startsAt: 0, duration: 24 },
    ]);
  });

  it("targets the exact instance among identical markers, leaving the rest", () => {
    // Three identical torches: removing index 1 must leave the other two, untouched.
    const before: TrackerState = {
      position: 288,
      markers: [
        { type: "torch", startsAt: 288, duration: 6 },
        { type: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
        { type: "torch", startsAt: 288, duration: 6 },
      ],
    };

    expect(removeMarker(1)(before).markers).toEqual([
      { type: "torch", startsAt: 288, duration: 6 },
      { type: "torch", startsAt: 288, duration: 6 },
    ]);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "torch", startsAt: 0, duration: 6 }],
    };

    expect(removeMarker(5)(before)).toBe(before);
  });
});

describe("renameMarker", () => {
  it("sets a custom label on a preset marker, keeping its type", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "torch", startsAt: 0, duration: 6 }],
    };

    expect(renameMarker(0, "Aragorn's torch")(before).markers).toEqual([
      { type: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 },
    ]);
  });

  it("clears a preset marker's label back to the default when the name is blank", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "torch", label: "Aragorn's torch", startsAt: 0, duration: 6 }],
    };

    expect(renameMarker(0, "  ")(before).markers).toEqual([
      { type: "torch", startsAt: 0, duration: 6 },
    ]);
  });

  it("renames the exact instance among identical markers, leaving already-labelled ones alone", () => {
    // Reproduces the reported bug: renaming a plain torch must not touch "Torch - A".
    const before: TrackerState = {
      position: 288,
      markers: [
        { type: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
        { type: "torch", startsAt: 288, duration: 6 },
        { type: "torch", startsAt: 288, duration: 6 },
      ],
    };

    const after = renameMarker(1, "Torch - B")(before);

    expect(after.markers).toEqual([
      { type: "torch", label: "Torch - A", startsAt: 288, duration: 6 },
      { type: "torch", label: "Torch - B", startsAt: 288, duration: 6 },
      { type: "torch", startsAt: 288, duration: 6 },
    ]);
  });

  it("replaces a custom marker's label", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "custom", label: "Web", startsAt: 0, duration: 12 }],
    };

    expect(renameMarker(0, "Giant Web")(before).markers).toEqual([
      { type: "custom", label: "Giant Web", startsAt: 0, duration: 12 },
    ]);
  });

  it("is a no-op when a custom marker is renamed to blank (its label is its only name)", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "custom", label: "Web", startsAt: 0, duration: 12 }],
    };

    expect(renameMarker(0, "  ")(before)).toBe(before);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = {
      position: 0,
      markers: [{ type: "torch", startsAt: 0, duration: 6 }],
    };

    expect(renameMarker(5, "x")(before)).toBe(before);
  });
});

describe("setRemaining", () => {
  it("adjusts duration so the marker has the given turns left, preserving consumed", () => {
    const before: TrackerState = {
      position: 12,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }], // consumed 2, remaining 4
    };

    expect(setRemaining(0, 10)(before).markers[0].duration).toBe(12); // 2 + 10
  });

  it("sets the duration directly for a freshly-created marker (nothing consumed yet)", () => {
    const before: TrackerState = {
      position: 10,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }],
    };

    expect(setRemaining(0, 3)(before).markers[0].duration).toBe(3);
  });

  it("expires the marker immediately when remaining is set to 0 (duration = consumed)", () => {
    const before: TrackerState = {
      position: 12,
      markers: [{ type: "torch", startsAt: 10, duration: 6 }], // consumed 2
    };

    const after = setRemaining(0, 0)(before);

    expect(after.markers[0].duration).toBe(2); // consumed, so expiresAt = 12 = position
    expect(resolveMarker(after.markers[0], after.position)).toMatchObject({
      phase: "expired",
      remaining: 0,
    });
  });

  it("keeps a paused marker's consumed burn frozen when setting remaining", () => {
    const before: TrackerState = {
      position: 20,
      markers: [{ type: "torch", startsAt: 0, duration: 6, pauses: [{ at: 3 }] }], // consumed 3
    };

    expect(setRemaining(0, 5)(before).markers[0].duration).toBe(8); // 3 + 5
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, markers: [] };

    expect(setRemaining(0, 5)(before)).toBe(before);
  });
});

describe("pauseMarker", () => {
  it("records a pause at the current position on the marker at the given index", () => {
    const before: TrackerState = {
      position: 291,
      markers: [{ type: "torch", startsAt: 288, duration: 6 }],
    };

    expect(pauseMarker(0)(before).markers[0].pauses).toEqual([{ at: 291 }]);
  });

  it("is a no-op when the marker is already paused", () => {
    const before: TrackerState = {
      position: 291,
      markers: [{ type: "torch", startsAt: 288, duration: 6, pauses: [{ at: 290 }] }],
    };

    expect(pauseMarker(0)(before)).toBe(before);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, markers: [] };

    expect(pauseMarker(0)(before)).toBe(before);
  });
});

describe("resumeMarker", () => {
  it("closes the open pause at the current position", () => {
    const before: TrackerState = {
      position: 300,
      markers: [{ type: "torch", startsAt: 288, duration: 6, pauses: [{ at: 291 }] }],
    };

    expect(resumeMarker(0)(before).markers[0].pauses).toEqual([{ at: 291, until: 300 }]);
  });

  it("is a no-op when the marker is not paused", () => {
    const before: TrackerState = {
      position: 300,
      markers: [{ type: "torch", startsAt: 288, duration: 6 }],
    };

    expect(resumeMarker(0)(before)).toBe(before);
  });
});

describe("addNote", () => {
  it("appends a note at the current position", () => {
    const before: TrackerState = { position: 42, markers: [] };

    expect(addNote("Party rests")(before).notes).toEqual([{ at: 42, text: "Party rests" }]);
  });

  it("anchors the note at an explicit turn when given (e.g. from a timeline box)", () => {
    const before: TrackerState = { position: 42, markers: [] };

    expect(addNote("Trap sprung", 10)(before).notes).toEqual([{ at: 10, text: "Trap sprung" }]);
  });

  it("keeps existing notes", () => {
    const before: TrackerState = {
      position: 5,
      markers: [],
      notes: [{ at: 1, text: "start" }],
    };

    expect(addNote("next", 5)(before).notes).toHaveLength(2);
  });
});

describe("editNote", () => {
  it("replaces the text of the note at the given index", () => {
    const before: TrackerState = {
      position: 0,
      markers: [],
      notes: [{ at: 3, text: "old" }],
    };

    expect(editNote(0, "new")(before).notes).toEqual([{ at: 3, text: "new" }]);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, markers: [], notes: [] };

    expect(editNote(0, "x")(before)).toBe(before);
  });
});

describe("removeNote", () => {
  it("removes the note at the given index", () => {
    const before: TrackerState = {
      position: 0,
      markers: [],
      notes: [
        { at: 1, text: "a" },
        { at: 2, text: "b" },
      ],
    };

    expect(removeNote(0)(before).notes).toEqual([{ at: 2, text: "b" }]);
  });

  it("leaves state unchanged for an out-of-range index", () => {
    const before: TrackerState = { position: 0, markers: [], notes: [{ at: 1, text: "a" }] };

    expect(removeNote(9)(before)).toBe(before);
  });
});

describe("clearAll", () => {
  it("empties the marker list, leaving position untouched", () => {
    const before: TrackerState = {
      position: 5,
      markers: [
        { type: "torch", duration: 11 },
        { type: "custom", label: "Pn", duration: 8 },
      ],
    };

    const after = clearAll(before);

    expect(after.markers).toEqual([]);
    expect(after.position).toBe(5);
  });
});

describe("advanceHours", () => {
  const base: TrackerState = { position: 10, markers: [] };

  it("advances position by hours × 6 turns", () => {
    expect(advanceHours(1)(base).position).toBe(16);
    expect(advanceHours(3)(base).position).toBe(28);
    expect(advanceHours(8)(base).position).toBe(58);
  });
});
