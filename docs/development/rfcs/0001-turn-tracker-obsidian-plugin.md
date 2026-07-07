# RFC: Convert the OSR Turn Tracker into an Obsidian Plugin

## Problem

The OSR Turn Tracker currently ships as a bundle of loose Markdown and JavaScript
assets that lean on four separate community tools to function at all:

- **ITS Theme** — for the `!checks` callout the tracker is rendered inside.
- **Templater** (`TemplaterScripts/build_turn_tracker.js`) — generates a fixed
  24-hour block of Markdown (`> [!checks|collapse] <date>`, hour rows, and
  144 `> - [ ] %% %%` checkbox lines) into the active note.
- **Meta-Bind** (`Button Templates.md`) — renders the action buttons.
- **JS Engine** — executes the `MetabindScripts/*.js` files those buttons fire.

Every stateful action is **regex surgery on the note's raw text**:
`end_tracker_turn.js` ticks the next box and demotes `**T**`→`*T*` to "expire" a
marker; `advance_tracker_hours.js` ticks 6·N boxes; `add_tracked_light_source.js`
and `track_custom_effect.js` insert/stack `**Label**` markers a fixed number of
turns ahead; `add_day_to_tracker.js` splices on another 24-hour block; and the
four "Clear" buttons are raw `regexpReplaceInNote` rules
(e.g. `(?<=^\s*>\s*-\s*\[[ xX]\]\s*%%\s*%%.*?)\s*(\*{1,2})(T|L)\d*\1`).

This is fragile and hostile to users:

- **Four required dependencies** plus a theme just to run five scripts. Setup is a
  nine-step manual process (copy scripts to specific folders, import button
  templates one-by-one via Meta-Bind settings, keep `MetabindScripts/` at the
  vault root or hand-edit hardcoded paths).
- **Brittle state.** State is inferred by re-scanning text with long regexes on
  every action. The README already lists formatting breakage as a known issue,
  and expiry is a one-way text mutation (`**`→`*`) that cannot be undone — there
  is no way to correct a mis-click or step backward.
- **Not distributable.** It cannot be installed, updated, or discovered like a
  normal Obsidian plugin.

The status quo is unacceptable because the tool's core value — a fast, reliable
tracker a DM drives during live play — is undermined by a setup and a runtime
that are both fiddly and easy to corrupt.

## Decisions

| # | Decision |
|---|----------|
| 1 | The tracker becomes a `turn-tracker` fenced code block rendered as an interactive widget via a `MarkdownCodeBlockProcessor`. The YAML inside the block is the single source of truth. This removes the ITS Theme, Templater, Meta-Bind, and JS Engine dependencies. |
| 2 | State schema: `start`, `calendar`, `position` (turns elapsed), `lights[]`, `effects[]`. Marker expiries are stored as **absolute turn indices**, not per-box mutations. |
| 3 | The grid is *computed* from `start` + `position` and auto-grows to `max(currentTurn, latestExpiry) + buffer`. "Add day" is deleted. The look-ahead buffer is a setting. |
| 4 | Three ways to act: buttons drawn inside the widget, hotkey-able Obsidian commands, and clicking a box to set `position`. Because expiry is computed (not baked in), jumping backward correctly re-activates markers that had not yet expired. |
| 5 | Torch and Lantern are editable **presets** (icon, label, duration in turns), each surfaced as a button; users can add more presets. One-off markers come from an "Add Effect" modal. Same-turn, same-label markers stack visually (`T`→`T2`). |
| 6 | Marker removal: each chip has an `×` that removes **one** (decrementing a stack, `T2`→`T`). Bulk actions collapse to just "Clear expired" and "Clear all"; the four-way lights/effects clear split is dropped. |
| 7 | `start` and `calendar` live in the code block. The "Insert tracker" command **seeds** them once from the note's `startTime` / `fc-calendar` frontmatter, then the block is self-contained. Calendarium remains an **optional** dependency, preserving the three header modes: `Day N`, real date, and fantasy date. |
| 8 | Turns are 10 minutes and days are 24 hours — enforced constants. Preset and effect **durations are entered and stored as turns** (Torch = 6, Lantern = 24, custom = N turns). The advance shortcuts (1h/3h/8h) are configurable. |
| 9 | The plugin ships its own CSS for the grid; no theme dependency. It stays OSR-flavored (exploration turns, torches, lanterns). |
| 10 | Clean break — no migration. Trackers made by the old Markdown tool are left untouched and inert; no converter is shipped. |
| 11 | Target the Obsidian community plugin store: guideline-clean (no `eval`, no `innerHTML`, detachable resources), versioned `manifest.json` / `versions.json`, and a release GitHub Action. |
| 12 | Tag the current `HEAD` as `v1.3-legacy` to preserve the Templater/Meta-Bind version, then remove the legacy assets from the repo root. The README links the tag. |
| 13 | Days render as collapsible sections in the widget (current day expanded by default). |

## Solution

### The code block

A tracker is authored as a fenced block. The plugin registers a processor for the
`turn-tracker` language and renders the widget in its place, in both Reading and
Live Preview modes.

````markdown
```turn-tracker
start: 2016-05-21T08:00      # ISO datetime, or omit for "Day 1 08:00"
calendar: Calendar of Greyhawk   # optional; requires Calendarium
position: 14                 # turns elapsed since start
lights:
  - { preset: torch,   expiresAt: 20 }
  - { preset: lantern, expiresAt: 38 }
effects:
  - { label: Poison, expiresAt: 33 }
```
````

- `position` is the only cursor: boxes `[0, position)` are ticked; the box at
  index `position` is "next".
- `expiresAt` is an absolute turn index. A marker is **active** while
  `position < expiresAt` and **expired** once `position >= expiresAt`. Nothing is
  mutated on expiry — it is derived on every render, which is what makes backward
  jumps reversible.
- `start` is snapped to the enclosing 10-minute turn; turn 0 is the turn
  containing `start`, so no partial pre-ticking is needed.

### State types (illustrative)

```ts
interface TrackerState {
  start?: string;            // ISO datetime; absent => Day-N mode from turn 0
  calendar?: string;         // Calendarium calendar name
  position: number;          // turns elapsed (>= 0)
  lights: Marker[];
  effects: Marker[];
}

interface Marker {
  preset?: string;           // preset id (lights); absent for ad-hoc effects
  label?: string;            // display label for ad-hoc effects
  expiresAt: number;         // absolute turn index
}

interface Preset {
  id: string;
  label: string;             // e.g. "Torch"
  icon: string;              // e.g. "flame"
  turns: number;             // duration in turns (Torch 6, Lantern 24)
  marker: string;            // short chip glyph, e.g. "T"
}

interface Settings {
  presets: Preset[];         // seeded with Torch (6) and Lantern (24)
  advanceShortcuts: number[];// hours, default [1, 3, 8]
  lookaheadBuffer: number;   // extra turns rendered past the latest expiry
}
```

### Actions

All actions read the current `TrackerState`, transform it, and rewrite the code
block's lines in the file (via `ctx.getSectionInfo(el)` to locate the block's line
range, then an editor/vault edit). The processor re-renders from the new YAML.

| Action | Effect on state |
|--------|-----------------|
| End Turn | `position += 1` |
| Advance Nh | `position += N * 6` |
| Click box *i* | `position = i` |
| Light preset *p* | push `{ preset: p, expiresAt: position + preset.turns }` into `lights` |
| Add Effect (modal: label, turns) | push `{ label, expiresAt: position + turns }` into `effects` |
| Chip `×` | remove one matching marker (decrement a same-turn/same-label stack) |
| Clear expired | drop markers where `expiresAt <= position` |
| Clear all | empty `lights` and `effects` |

Core actions (End Turn, the advance shortcuts) are also registered as Obsidian
commands so they can be bound to hotkeys and invoked from the command palette;
they operate on the tracker block in the active note.

### Rendering

The widget computes the visible range as
`start … max(position, maxExpiry) + lookaheadBuffer`, groups turns into hour rows
(6 per hour) and days (24 hours), and renders each day as a collapsible section
with a header. The header text uses Calendarium fantasy dates when `calendar` is
set and the plugin is present, a formatted real date when `start` is a datetime,
or `Day N` otherwise — mirroring the current three modes. Active markers render as
chips with an `×`; expired markers render dimmed. Same-turn, same-label markers
collapse to a counted chip (`T2`).

### Before / after (call sites)

- **Before:** author runs the Templater "Build Turn Tracker" Meta-Bind button,
  which injects ~150 lines of Markdown; actions fire JS-Engine scripts that regex
  the note text.
- **After:** author runs the **Insert Turn Tracker** command (or types the fenced
  block); actions are widget buttons / commands that edit a small YAML block.

## Implementation Recommendations

- **Repo restructure.** Move to the standard Obsidian plugin layout: `manifest.json`,
  `versions.json`, `src/` (TypeScript), `styles.css`, `esbuild.config.mjs`,
  `package.json`, and a `.github` release workflow. Plugin id `osr-turn-tracker`,
  display name "OSR Turn Tracker". Do this after tagging.
- **Migration order.**
  1. `git tag v1.3-legacy` on the current `HEAD` and push the tag.
  2. Remove `TemplaterScripts/`, `MetabindScripts/`, `Button Templates.md`,
     `TurnTracker/`, and `Demo/` from the working tree.
  3. Scaffold the plugin; port `build_turn_tracker.js`'s header/date logic
     (real-date ordinal formatting, Calendarium weekday/month lookup via
     `getStore().getDaysBeforeDate`) into a TypeScript date-formatting module —
     this is the one piece worth salvaging rather than rewriting.
  4. Implement the processor, state (de)serialization, actions, commands, and
     settings tab.
  5. Rewrite `README.md`: new install/usage, and a link to `v1.3-legacy` for the
     old Templater approach.
- **Community-store hygiene (do from the start, not as cleanup).** No `eval` /
  `new Function`; build the DOM with `createEl`/`createDiv` rather than
  `innerHTML`; no network calls; detach all event handlers and intervals in
  `onunload`; declare Calendarium as optional and feature-detect it at runtime
  rather than hard-importing.
- **Persisting edits safely.** Resolve the block's line range from
  `ctx.getSectionInfo(el)` at click time (not render time) so concurrent edits
  don't corrupt offsets. Write the block back as canonical YAML the plugin owns;
  do not attempt to preserve user comments inside the block.
- **Edge cases to handle.**
  - Multiple `turn-tracker` blocks in one note: each widget must key off its own
    section range, never a note-wide search.
  - Malformed / hand-edited YAML: render a clear inline error with the raw block
    still visible, never throw.
  - `position` at or beyond the current visible end: End Turn just extends the
    grid (auto-grow), never errors — there is no "end" to hit and no "Add day".
  - Negative or backward jumps: allowed; recompute expiry states, don't clamp.
  - Calendarium absent but `calendar` set: fall back to real-date / `Day N`
    formatting with a subtle notice, don't fail.
- **Do not add:** an "Add day" control, a lights-vs-effects clear taxonomy, a
  legacy converter, or configurable turn/day lengths — all explicitly out of scope
  per Decisions 3, 6, 8, and 10.
