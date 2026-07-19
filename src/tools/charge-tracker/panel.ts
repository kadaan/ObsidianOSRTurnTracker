/** Derive the charge-tracker's display sections from its state (pure, Obsidian-free). */

import { ChargeItem, ChargeTrackerState } from "./model";

/** An item paired with its index in the state array, so a row's controls target the right item. */
export interface ChargeRow {
  item: ChargeItem;
  index: number;
}

/** Items grouped for display: those with charges left, and the spent ones shown as dimmed history. */
export interface ChargePanel {
  available: ChargeRow[];
  exhausted: ChargeRow[];
}

/** An item is exhausted once it has no charges left. */
const isExhausted = (item: ChargeItem): boolean => item.current === 0;

/** Split items into available and exhausted, each sorted alphabetically by name. Every row keeps its
 *  original array index, so the widget's controls still target the right item after sorting. */
export function computeChargePanel(state: ChargeTrackerState): ChargePanel {
  const available: ChargeRow[] = [];
  const exhausted: ChargeRow[] = [];
  state.items.forEach((item, index) => {
    (isExhausted(item) ? exhausted : available).push({ item, index });
  });
  const byName = (a: ChargeRow, b: ChargeRow) => a.item.name.localeCompare(b.item.name);
  available.sort(byName);
  exhausted.sort(byName);
  return { available, exhausted };
}
