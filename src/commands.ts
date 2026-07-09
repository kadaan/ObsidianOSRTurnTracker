/**
 * Command ids for the tracker's actions — the single source shared by command registration (main.ts)
 * and the hotkey hints shown on the widget's buttons (render.ts), so a hint always matches the
 * command it hints at. Ids are relative to the plugin; Obsidian namespaces them as `<pluginId>:<id>`.
 */
export const commandIds = {
  endTurn: "end-turn",
  clearExpired: "clear-expired",
  clearAll: "clear-all",
  addNote: "add-note",
  addEffect: "add-effect",
  advance: (hours: number): string => `advance-${hours}h`,
  light: (presetId: string): string => `light-${presetId}`,
};
