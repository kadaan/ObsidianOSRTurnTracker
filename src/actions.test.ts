import { describe, it, expect } from "vitest";
import { endTurn } from "./actions";
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
