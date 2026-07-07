import { Pause } from "./model";

export type MarkerPhase = "upcoming" | "active" | "paused" | "expired";

export interface ResolvedMarker {
  phase: MarkerPhase;
  startsAt: number;
  /** Effective expiry: the original schedule pushed out by completed pause time. */
  expiresAt: number;
  /** Active burn intervals `[from, to)`, with pause gaps excluded and truncated at an open pause. */
  segments: Array<[number, number]>;
  /** Burn turns remaining (frozen while paused). */
  remaining: number;
}

/**
 * Rebuild a marker's burn state from its scheduled window and pause history, relative to the
 * current `position`. A pause freezes the burn; a completed pause pushes the expiry out by its
 * duration, so resuming continues the remaining burn from the resume point.
 */
export function resolveMarker(
  m: { startsAt?: number; duration: number; pauses?: Pause[] },
  position: number,
): ResolvedMarker {
  const startsAt = m.startsAt ?? 0;
  const duration = m.duration;
  const scheduledExpiry = startsAt + duration;
  const pauses = [...(m.pauses ?? [])].sort((a, b) => a.at - b.at);

  const segments: Array<[number, number]> = [];
  let cursor = startsAt;
  let completedShift = 0;
  let openAt: number | undefined;
  for (const p of pauses) {
    segments.push([cursor, p.at]);
    if (p.until === undefined) {
      openAt = p.at;
      break;
    }
    completedShift += p.until - p.at;
    cursor = p.until;
  }

  const expiresAt = scheduledExpiry + completedShift;
  if (openAt === undefined) segments.push([cursor, expiresAt]);

  let phase: MarkerPhase;
  let remaining: number;
  if (position < startsAt) {
    phase = "upcoming";
    remaining = duration;
  } else if (openAt !== undefined && openAt <= position) {
    phase = "paused";
    remaining = expiresAt - openAt; // frozen while paused
  } else if (position >= expiresAt) {
    phase = "expired";
    remaining = 0;
  } else {
    phase = "active";
    remaining = expiresAt - position;
  }

  return { phase, startsAt, expiresAt, segments, remaining: Math.max(0, remaining) };
}

/** Whether `turn` falls inside any active burn segment `[from, to)`. */
export const inSegments = (segments: Array<[number, number]>, turn: number): boolean =>
  segments.some(([from, to]) => from <= turn && turn < to);
