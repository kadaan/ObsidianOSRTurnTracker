/** Autocomplete while hand-editing a `turn-tracker` fence — the one place the interactive widget
 *  isn't shown. */

import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
} from "obsidian";
import { OPEN_FENCE } from "./block";
import { calendarNames } from "./calendarium";
import { CUSTOM_TYPE, LEGACY_EFFECT_KEYS, TOP_LEVEL_KEYS } from "./model";
import { OsrTurnTrackerSettings } from "./settings";

type TrackerSuggestion = { display: string; hint: string; insert: string };
type Section = "top" | "effects" | "notes";
type ListSection = Exclude<Section, "top">;

/** Per-list-section data: the entry keys, the value that starts an entry, and the "new entry" label. */
const SECTION_ENTRIES: Record<ListSection, { keys: string[]; scaffold: string; newLabel: string }> = {
  effects: {
    keys: ["type", "label", "startsAt", "duration", "pauses"],
    scaffold: "type: ",
    newLabel: "- type: … (new effect)",
  },
  notes: { keys: ["at", "text"], scaffold: "at: ", newLabel: "- at: … (new note)" },
};

const EFFECT_SECTION_KEYS = new Set<string>(["effects", ...LEGACY_EFFECT_KEYS]);

/** The section a column-0 `key:` opens. */
function sectionFor(key: string): Section {
  if (EFFECT_SECTION_KEYS.has(key)) return "effects";
  if (key === "notes") return "notes";
  return "top";
}

const FENCE_LINE = /^`{3,}/;
const TYPE_VALUE_RE = /^\s*(?:-\s*)?type:\s*(\S*)$/;
// The `calendar:` value can contain spaces (e.g. "Calendar of Greyhawk"), so capture the whole rest.
const CALENDAR_VALUE_RE = /^calendar:\s*(.*)$/;
// An optional indent, an optional list dash, a partial word. A line with a colon never matches, so a
// completed `key:` doesn't re-trigger (and neither does mid-sentence prose).
const STRUCTURE_RE = /^(\s*)(-\s*)?([A-Za-z]*)$/;

/**
 * Section-aware autocomplete: top-level keys at column 0, a `- type:`/`- at:` scaffold and entry
 * keys inside `effects:`/`notes:`, the preset ids (plus `custom`) on a `type:` value, and the
 * installed Calendarium calendars on a `calendar:` value.
 */
export class TrackerSuggest extends EditorSuggest<TrackerSuggestion> {
  // Context captured in onTrigger, consumed in getSuggestions.
  private mode: "type" | "calendar" | "structure" = "structure";
  private section: Section = "top";
  private indented = false;
  private hasDash = false;

  constructor(
    app: App,
    private readonly settings: OsrTurnTrackerSettings,
  ) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    // Cheap per-line rejection before the buffer scan: a `type:`/`calendar:` value or a key/list anchor.
    const typeMatch = before.match(TYPE_VALUE_RE);
    const calendarMatch = typeMatch ? null : before.match(CALENDAR_VALUE_RE);
    const structMatch = typeMatch || calendarMatch ? null : before.match(STRUCTURE_RE);
    if (!typeMatch && !calendarMatch && !structMatch) return null;

    const { inside, section } = this.scanUp(editor, cursor.line);
    if (!inside) return null;

    if (typeMatch || calendarMatch) {
      this.mode = typeMatch ? "type" : "calendar";
      const value = (typeMatch ?? calendarMatch)![1];
      return { start: { line: cursor.line, ch: cursor.ch - value.length }, end: cursor, query: value };
    }

    const [, indent, dash, word] = structMatch!;
    // Stay quiet on empty top-level lines; in a list section, offer help even on a blank line.
    if (word.length === 0 && section === "top") return null;

    this.mode = "structure";
    this.section = section;
    this.indented = indent.length > 0;
    this.hasDash = !!dash;
    return { start: { line: cursor.line, ch: cursor.ch - word.length }, end: cursor, query: word };
  }

  getSuggestions(context: EditorSuggestContext): TrackerSuggestion[] {
    const q = context.query.toLowerCase();
    // Both value modes append a trailing space to terminate the value, so selecting it doesn't
    // immediately re-fire the same trigger and leave the popup stuck open.
    if (this.mode === "type") {
      return [...this.settings.presets.map((p) => p.id), CUSTOM_TYPE]
        .filter((id) => id.toLowerCase().startsWith(q))
        .map((id) => ({
          display: id,
          hint: id === CUSTOM_TYPE ? "free-text effect" : "preset",
          insert: `${id} `,
        }));
    }
    if (this.mode === "calendar") {
      return calendarNames()
        .filter((name) => name.toLowerCase().startsWith(q))
        .map((name) => ({ display: name, hint: "calendar", insert: `${name} ` }));
    }

    const out: TrackerSuggestion[] = [];
    const col0 = !this.indented && !this.hasDash;
    const entry = this.section === "top" ? undefined : SECTION_ENTRIES[this.section];

    // Start a new list entry — only when not already mid-entry (no dash) and not typing a key name.
    if (entry && context.query === "" && !this.hasDash) {
      out.push({ display: entry.newLabel, hint: "new entry", insert: `${col0 ? "  - " : "- "}${entry.scaffold}` });
    }
    // Keys of the current entry (on a dashed or indented line within a list section).
    if (entry && (this.hasDash || this.indented)) {
      for (const key of entry.keys) {
        if (key.toLowerCase().startsWith(q)) out.push({ display: `${key}:`, hint: "", insert: `${key}: ` });
      }
    }
    // Top-level keys when writing at column 0.
    if (col0) {
      for (const key of TOP_LEVEL_KEYS) {
        if (key.startsWith(q)) out.push({ display: `${key}:`, hint: "", insert: `${key}: ` });
      }
    }
    return out;
  }

  renderSuggestion(value: TrackerSuggestion, el: HTMLElement): void {
    el.createSpan({ text: value.display });
    if (value.hint) el.createSpan({ cls: "osr-tt-suggest-hint", text: value.hint });
  }

  selectSuggestion(value: TrackerSuggestion): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange(value.insert, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + value.insert.length });
  }

  /**
   * One upward pass answering both questions onTrigger needs: is the cursor inside a turn-tracker
   * fence, and which section is it in (from the nearest column-0 key). The nearest fence above bounds
   * the search — the cursor is "inside" only if that fence opens a turn-tracker block.
   */
  private scanUp(editor: Editor, line: number): { inside: boolean; section: Section } {
    let section: Section = "top";
    let sectionKnown = false;
    for (let i = line - 1; i >= 0; i--) {
      const text = editor.getLine(i);
      const trimmed = text.trim();
      if (FENCE_LINE.test(trimmed)) return { inside: OPEN_FENCE.test(trimmed), section };
      if (!sectionKnown) {
        const m = text.match(/^([A-Za-z]+):/); // a column-0 key sets the enclosing section
        if (m) {
          section = sectionFor(m[1]);
          sectionKnown = true;
        }
      }
    }
    return { inside: false, section: "top" };
  }
}
