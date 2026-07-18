import { clamp } from "../../core/validate";
import { ChargeItem, ChargeTransform, MAX_CHARGES } from "./model";

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

/** Set an item's max, clamped into [0, MAX_CHARGES]; a lowered max pulls current down with it. */
export const setMax = (index: number, value: number): ChargeTransform =>
  mapItem(index, (item) => {
    const max = clamp(value, 0, MAX_CHARGES);
    return { ...item, max, current: Math.min(item.current, max) };
  });

/** Append a new item to the list. */
export const addItem = (item: ChargeItem): ChargeTransform => (state) => ({
  items: [...state.items, item],
});

/** Remove the item at `index`. */
export const removeItem = (index: number): ChargeTransform => (state) => ({
  items: state.items.filter((_, i) => i !== index),
});
