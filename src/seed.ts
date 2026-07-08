import { TrackerState } from "./model";

/** Which frontmatter properties a new tracker seeds its calendar and start date from. */
export interface SeedProperties {
  calendarProperty: string;
  startProperty: string;
}

/**
 * Build the initial state for a freshly-inserted tracker, seeding `start` and `calendar` from the
 * note's frontmatter using the property names in `props` (their defaults live in `settings.ts`).
 */
export function seedTrackerState(
  frontmatter: Record<string, unknown> | undefined,
  props: SeedProperties,
): TrackerState {
  const state: TrackerState = { position: 0, markers: [] };

  const start = frontmatter?.[props.startProperty];
  if (typeof start === "string") state.start = start;

  const calendar = frontmatter?.[props.calendarProperty];
  if (typeof calendar === "string") state.calendar = calendar;

  return state;
}
