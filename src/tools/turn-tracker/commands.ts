/**
 * Command ids for the tracker's actions — the single source shared by command registration (main.ts)
 * and the hotkey hints shown on the widget's buttons (render.ts), so a hint always matches the
 * command it hints at. Ids are namespaced under the tool (`osr-tools-turn-tracker:<cmd>`); Obsidian
 * namespaces them again under the plugin as `<pluginId>:osr-tools-turn-tracker:<cmd>`.
 */
import { TRACKER_LANG } from "./model";

/** Namespace a command under the tool, so future tools' commands never collide. */
const ns = (cmd: string): string => `${TRACKER_LANG}:${cmd}`;

export const commandIds = {
  endTurn: ns("end-turn"),
  clearExpired: ns("clear-expired"),
  clearAll: ns("clear-all"),
  addNote: ns("add-note"),
  addEffect: ns("add-effect"),
  insert: ns("insert-tracker"),
  advance: (hours: number): string => ns(`advance-${hours}h`),
  light: (presetId: string): string => ns(`light-${presetId}`),
};

/** A command's stable id and its display name — the tool's declarative command list. */
export interface CommandSpec {
  id: string;
  name: string;
}

/**
 * The turn tracker's commands for the given settings: the static commands plus one Advance command
 * per configured shortcut and one Light command per preset. Pure — the host attaches each id's
 * editor action separately. Changing the list takes effect on reload.
 */
export function turnTrackerCommandSpecs(
  advanceShortcuts: number[],
  presets: { id: string; label: string }[],
): CommandSpec[] {
  return [
    { id: commandIds.endTurn, name: "End turn" },
    ...advanceShortcuts.map((hours) => ({
      id: commandIds.advance(hours),
      name: `Advance ${hours} hour${hours === 1 ? "" : "s"}`,
    })),
    { id: commandIds.clearExpired, name: "Clear expired markers" },
    { id: commandIds.clearAll, name: "Clear all markers" },
    { id: commandIds.addNote, name: "Add note" },
    { id: commandIds.addEffect, name: "Add effect" },
    ...presets.map((preset) => ({ id: commandIds.light(preset.id), name: `Light: ${preset.label}` })),
    { id: commandIds.insert, name: "Insert turn tracker" },
  ];
}
