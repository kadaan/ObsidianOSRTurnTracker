import { Plugin } from "obsidian";
import { parseTrackerState } from "./parse";
import { renderError, renderTracker } from "./render";

export default class OsrTurnTrackerPlugin extends Plugin {
  async onload() {
    // Processors registered on the plugin are auto-detached on unload.
    this.registerMarkdownCodeBlockProcessor("turn-tracker", (source, el) => {
      const result = parseTrackerState(source);
      if (!result.ok) {
        renderError(el, result.error);
        return;
      }
      renderTracker(el, result.state);
    });
  }
}
