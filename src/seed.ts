import { TrackerState } from "./model";

/**
 * Build the initial state for a freshly-inserted tracker, seeding `start`/`calendar`
 * from the note's frontmatter (`startTime` / `fc-calendar`) when present.
 */
export function seedTrackerState(frontmatter: Record<string, unknown> | undefined): TrackerState {
  const state: TrackerState = { position: 0, lights: [], effects: [] };

  const start = frontmatter?.startTime;
  if (typeof start === "string") state.start = start;

  const calendar = frontmatter?.["fc-calendar"];
  if (typeof calendar === "string") state.calendar = calendar;

  return state;
}
