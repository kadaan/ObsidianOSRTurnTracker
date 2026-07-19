import { describe, it, expect } from "vitest";
import {
  addItem,
  decrementCharge,
  incrementCharge,
  recharge,
  removeItem,
  renameItem,
  setCharge,
  setMax,
} from "./actions";
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

describe("setMax", () => {
  it("sets max and clamps current down when it exceeds the new max", () => {
    const s = state([{ name: "Wand", current: 5, max: 7 }]);

    expect(setMax(0, 3)(s).items[0]).toEqual({ name: "Wand", current: 3, max: 3 });
    expect(setMax(0, 10)(s).items[0]).toEqual({ name: "Wand", current: 5, max: 10 });
  });

  it("clamps max to the render cap and floors at zero", () => {
    const s = state([{ name: "Wand", current: 5, max: 7 }]);

    expect(setMax(0, 999999)(s).items[0].max).toBe(1000);
    expect(setMax(0, -3)(s).items[0]).toEqual({ name: "Wand", current: 0, max: 0 });
  });
});

describe("recharge", () => {
  it("adds to current, never past the (possibly new) max", () => {
    const s = state([{ name: "Wand", current: 2, max: 7 }]);

    expect(recharge(0, 3, 7)(s).items[0]).toEqual({ name: "Wand", current: 5, max: 7 });
    expect(recharge(0, 100, 7)(s).items[0].current).toBe(7); // over-add caps at max
  });

  it("sets a new max and pulls current down to it", () => {
    const s = state([{ name: "Wand", current: 6, max: 7 }]);

    expect(recharge(0, 0, 3)(s).items[0]).toEqual({ name: "Wand", current: 3, max: 3 });
  });

  it("clamps the new max to the render cap and floors it at zero", () => {
    const s = state([{ name: "Wand", current: 1, max: 1 }]);

    expect(recharge(0, 0, 999999)(s).items[0].max).toBe(1000);
    expect(recharge(0, 5, -3)(s).items[0]).toEqual({ name: "Wand", current: 0, max: 0 });
  });
});

describe("addItem / removeItem", () => {
  it("appends a new item and removes one by index", () => {
    const s = state([{ name: "Wand", current: 2, max: 5 }]);

    const added = addItem({ name: "Staff", current: 3, max: 3 })(s);
    expect(added.items).toHaveLength(2);
    expect(added.items[1]).toEqual({ name: "Staff", current: 3, max: 3 });

    expect(removeItem(0)(added).items).toEqual([{ name: "Staff", current: 3, max: 3 }]);
  });
});
