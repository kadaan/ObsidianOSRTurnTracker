import { describe, it, expect } from "vitest";
import { computeChargePanel } from "./panel";
import { ChargeTrackerState } from "./model";

const state = (items: ChargeTrackerState["items"]): ChargeTrackerState => ({ items });

describe("computeChargePanel", () => {
  it("splits items into available (current > 0) and exhausted (current === 0)", () => {
    const s = state([
      { name: "Wand", current: 2, max: 3 },
      { name: "Staff", current: 0, max: 5 },
      { name: "Rod", current: 1, max: 1 },
    ]);

    const panel = computeChargePanel(s);

    expect(panel.available.map((r) => r.item.name)).toEqual(["Rod", "Wand"]);
    expect(panel.exhausted.map((r) => r.item.name)).toEqual(["Staff"]);
  });

  it("sorts each list alphabetically by name, keeping original indices for the controls", () => {
    const s = state([
      { name: "Wand", current: 3, max: 3 },
      { name: "Amulet", current: 1, max: 2 },
      { name: "Rod", current: 2, max: 2 },
    ]);

    const panel = computeChargePanel(s);

    expect(panel.available.map((r) => r.item.name)).toEqual(["Amulet", "Rod", "Wand"]);
    expect(panel.available.map((r) => r.index)).toEqual([1, 2, 0]); // original array positions
  });

  it("keeps each row's original index so actions target the right item", () => {
    const s = state([
      { name: "Wand", current: 0, max: 3 },
      { name: "Staff", current: 4, max: 5 },
    ]);

    const panel = computeChargePanel(s);

    expect(panel.available[0].index).toBe(1);
    expect(panel.exhausted[0].index).toBe(0);
  });
});
