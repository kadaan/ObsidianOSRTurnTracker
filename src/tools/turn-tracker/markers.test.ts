import { describe, it, expect } from "vitest";
import { markerEventAt, resolveMarker } from "./markers";

describe("resolveMarker", () => {
  it("resolves an un-paused marker to a single active segment", () => {
    const r = resolveMarker({ startsAt: 10, duration: 6 }, 12);

    expect(r).toEqual({
      phase: "active",
      startsAt: 10,
      expiresAt: 16,
      segments: [[10, 16]],
      remaining: 4,
    });
  });

  it("reports expired past the expiry, with zero remaining", () => {
    expect(resolveMarker({ startsAt: 10, duration: 6 }, 20)).toMatchObject({
      phase: "expired",
      remaining: 0,
    });
  });

  it("reports upcoming before the start, with the full duration remaining", () => {
    expect(resolveMarker({ startsAt: 10, duration: 6 }, 5)).toMatchObject({
      phase: "upcoming",
      remaining: 6,
    });
  });

  it("freezes a currently-paused marker: span stops at the pause, remaining held", () => {
    const r = resolveMarker({ startsAt: 0, duration: 6, pauses: [{ at: 3 }] }, 3);

    expect(r).toMatchObject({
      phase: "paused",
      expiresAt: 6,
      segments: [[0, 3]],
      remaining: 3,
    });
  });

  it("keeps a paused marker frozen even as the position advances", () => {
    const r = resolveMarker({ startsAt: 0, duration: 6, pauses: [{ at: 3 }] }, 20);

    expect(r).toMatchObject({ phase: "paused", segments: [[0, 3]], remaining: 3 });
  });

  it("shifts the effective expiry by the paused duration once resumed", () => {
    // Paused at 3, resumed at 10 (7 turns paused) → 3 burn left, now expiring at 13.
    const r = resolveMarker({ startsAt: 0, duration: 6, pauses: [{ at: 3, until: 10 }] }, 10);

    expect(r).toEqual({
      phase: "active",
      startsAt: 0,
      expiresAt: 13,
      segments: [
        [0, 3],
        [10, 13],
      ],
      remaining: 3,
    });
  });

  it("expires a resumed marker at its shifted expiry", () => {
    expect(resolveMarker({ startsAt: 0, duration: 6, pauses: [{ at: 3, until: 10 }] }, 13)).toMatchObject({
      phase: "expired",
      remaining: 0,
    });
  });

  it("accumulates multiple pauses", () => {
    const r = resolveMarker(
      { startsAt: 0, duration: 6, pauses: [{ at: 2, until: 5 }, { at: 7 }] },
      8,
    );

    expect(r).toMatchObject({
      phase: "paused",
      expiresAt: 9, // 6 + 3 completed pause turns
      segments: [
        [0, 2],
        [5, 7],
      ],
      remaining: 2, // 9 - 7
    });
  });

  it("treats a pause as not-yet-happened when the position is rewound before it", () => {
    const r = resolveMarker({ startsAt: 0, duration: 6, pauses: [{ at: 3 }] }, 1);

    expect(r.phase).toBe("active");
  });
});

describe("markerEventAt", () => {
  const resolved = { startsAt: 10, expiresAt: 16, segments: [[10, 16]] as Array<[number, number]> };

  it("reports a start on the first burning turn", () => {
    expect(markerEventAt(resolved, 10)).toBe("start");
  });

  it("reports a stop on the final burning turn (expiresAt - 1)", () => {
    expect(markerEventAt(resolved, 15)).toBe("stop");
    expect(markerEventAt(resolved, 16)).toBeUndefined(); // expiresAt itself is already out
  });

  it("returns undefined for a turn mid-burn", () => {
    expect(markerEventAt(resolved, 12)).toBeUndefined();
  });

  it("reports pause on the last turn before a pause and resume on the turn it continues", () => {
    // paused at 3 (resumed at 10): segments [0,3) and [10,13), effective expiry 13.
    const m = { startsAt: 0, expiresAt: 13, segments: [[0, 3], [10, 13]] as Array<[number, number]> };

    expect(markerEventAt(m, 0)).toBe("start");
    expect(markerEventAt(m, 2)).toBe("pause"); // last turn of the first segment, ends at a pause
    expect(markerEventAt(m, 10)).toBe("resume"); // first turn of the second segment
    expect(markerEventAt(m, 12)).toBe("stop"); // final burning turn (13 - 1)
  });

  it("reports pause (not stop) on the last turn of a still-open pause", () => {
    // paused at 3, never resumed: only segment [0,3), projected expiry 6 (unreached).
    const m = { startsAt: 0, expiresAt: 6, segments: [[0, 3]] as Array<[number, number]> };

    expect(markerEventAt(m, 2)).toBe("pause");
  });
});
