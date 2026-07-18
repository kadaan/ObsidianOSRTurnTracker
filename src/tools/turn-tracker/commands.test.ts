import { describe, it, expect } from "vitest";
import { turnTrackerCommandSpecs } from "./commands";

describe("turnTrackerCommandSpecs", () => {
  it("namespaces ids under the tool and generates one command per advance shortcut", () => {
    const specs = turnTrackerCommandSpecs([1, 3], []);
    const ids = specs.map((s) => s.id);

    expect(ids).toContain("osr-tools-turn-tracker:end-turn");
    expect(ids).toContain("osr-tools-turn-tracker:advance-1h");
    expect(ids).toContain("osr-tools-turn-tracker:advance-3h");
    expect(specs.find((s) => s.id === "osr-tools-turn-tracker:advance-1h")?.name).toBe("Advance 1 hour");
    expect(specs.find((s) => s.id === "osr-tools-turn-tracker:advance-3h")?.name).toBe("Advance 3 hours");
  });

  it("generates one Light command per preset with its label, plus the insert command", () => {
    const specs = turnTrackerCommandSpecs(
      [],
      [
        { id: "torch", label: "Torch" },
        { id: "lantern", label: "Lantern" },
      ],
    );

    expect(specs.find((s) => s.id === "osr-tools-turn-tracker:light-torch")?.name).toBe("Light: Torch");
    expect(specs.find((s) => s.id === "osr-tools-turn-tracker:light-lantern")?.name).toBe(
      "Light: Lantern",
    );
    expect(specs.map((s) => s.id)).toContain("osr-tools-turn-tracker:insert-tracker");
  });
});
