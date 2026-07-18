import { describe, it, expect } from "vitest";
import { decrementCharge, incrementCharge, renameItem, setCharge } from "./actions";
import { ChargeTrackerState } from "./model";

const state = (items: ChargeTrackerState["items"]): ChargeTrackerState => ({ items });

describe("incrementCharge", () => {
  it("raises the item's current by one but never past max", () => {
    const s = state([{ name: "Wand", current: 2, max: 3 }]);

    expect(incrementCharge(0)(s).items[0].current).toBe(3);
    expect(incrementCharge(0)(incrementCharge(0)(s)).items[0].current).toBe(3);
  });
});

describe("decrementCharge", () => {
  it("lowers the item's current by one but never below zero", () => {
    const s = state([{ name: "Wand", current: 1, max: 3 }]);

    expect(decrementCharge(0)(s).items[0].current).toBe(0);
    expect(decrementCharge(0)(decrementCharge(0)(s)).items[0].current).toBe(0);
  });
});

describe("setCharge", () => {
  it("sets current to the given value, clamped to [0, max]", () => {
    const s = state([{ name: "Wand", current: 2, max: 5 }]);

    expect(setCharge(0, 4)(s).items[0].current).toBe(4);
    expect(setCharge(0, 9)(s).items[0].current).toBe(5);
    expect(setCharge(0, -3)(s).items[0].current).toBe(0);
  });
});

describe("renameItem", () => {
  it("renames the item, leaving its charges untouched", () => {
    const s = state([{ name: "Wand", current: 2, max: 5 }]);

    expect(renameItem(0, "Wand of Fireballs")(s).items[0]).toEqual({
      name: "Wand of Fireballs",
      current: 2,
      max: 5,
    });
  });
});
