import { ChargeItem, ChargeTransform } from "./model";

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Map the item at `index` through `change`, leaving the rest (and their identity) untouched. */
const mapItem =
  (index: number, change: (item: ChargeItem) => ChargeItem): ChargeTransform =>
  (state) => ({ items: state.items.map((item, i) => (i === index ? change(item) : item)) });

/** Restore one charge to an item, never past its max. */
export const incrementCharge = (index: number): ChargeTransform =>
  mapItem(index, (item) => ({ ...item, current: clamp(item.current + 1, 0, item.max) }));

/** Spend one charge from an item, never below zero. */
export const decrementCharge = (index: number): ChargeTransform =>
  mapItem(index, (item) => ({ ...item, current: clamp(item.current - 1, 0, item.max) }));

/** Set an item's current charge to an exact value, clamped into [0, max]. */
export const setCharge = (index: number, value: number): ChargeTransform =>
  mapItem(index, (item) => ({ ...item, current: clamp(value, 0, item.max) }));

/** Rename an item, leaving its charge counts untouched. */
export const renameItem = (index: number, name: string): ChargeTransform =>
  mapItem(index, (item) => ({ ...item, name }));
