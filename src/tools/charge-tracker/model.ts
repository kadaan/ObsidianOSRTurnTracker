/** Core domain model for the charge tracker: named items with a current/max charge count. */

/** The code-block language / fence info-string that identifies a charge tracker. */
export const CHARGE_LANG = "osr-tools-charge-tracker";

/**
 * Upper bound on an item's `max`, guarding against a hand-entered value that would render a
 * runaway number of charge pips and freeze the widget (mirrors the tracker's `MAX_POSITION`).
 */
export const MAX_CHARGES = 1000;

/** A charged item (wand, staff, …). Invariant, enforced by the codec and transforms: 0 ≤ current ≤ max. */
export interface ChargeItem {
  name: string;
  current: number;
  max: number;
}

/** The full state of a charge tracker, as stored in a `charge-tracker` code block. */
export interface ChargeTrackerState {
  items: ChargeItem[];
}

/** A pure state transition (e.g. increment a charge). */
export type ChargeTransform = (state: ChargeTrackerState) => ChargeTrackerState;
