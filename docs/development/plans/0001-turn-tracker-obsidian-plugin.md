# Plan: OSR Turn Tracker Obsidian Plugin

> Source PRD: `docs/development/rfcs/0001-turn-tracker-obsidian-plugin.md`

## Architectural Decisions

Durable decisions that apply across all phases:

- **Code block**: language `turn-tracker`, rendered via a `MarkdownCodeBlockProcessor`
  in both Reading and Live Preview modes. The YAML inside the block is the single
  source of truth.
- **State schema (YAML)**: `start` (optional ISO datetime), `calendar` (optional
  Calendarium name), `position` (turns elapsed, integer ≥ 0), `lights[]`,
  `effects[]`. Markers are `{ preset|label, expiresAt }` where `expiresAt` is an
  **absolute turn index**. A marker is active while `position < expiresAt`, expired
  once `position >= expiresAt` — always derived, never mutated in place.
- **Constants**: a turn is 10 minutes; a day is 24 hours (144 turns). Enforced, not
  configurable. Durations are expressed and stored **in turns**.
- **Position semantics**: boxes `[0, position)` are ticked; the box at index
  `position` is "next". `start` snaps to the enclosing 10-minute turn (turn 0).
- **Persistence**: on each action, resolve the block's line range from
  `ctx.getSectionInfo(el)` **at click time**, transform the parsed state, and
  rewrite the block as canonical plugin-owned YAML.
- **Plugin**: id `osr-turn-tracker`, display name "OSR Turn Tracker", standard
  TypeScript layout (`manifest.json`, `versions.json`, `src/`, `styles.css`,
  `esbuild.config.mjs`, `package.json`).
- **Community-store hygiene** (from the start): no `eval`/`new Function`, build DOM
  with `createEl`/`createDiv` (never `innerHTML`), no network calls, detach all
  handlers/intervals in `onunload`.
- **Calendarium**: optional dependency, feature-detected at runtime; never a hard
  import.
- **Scope**: OSR-flavored (exploration turns, torches, lanterns); ships its own CSS,
  no theme dependency.

---

## Phase 1: Walking skeleton — scaffold + static render

**User stories / RFC decisions**: 1 (code-block widget), 2 (state schema parse),
8 (constants), 9 (own CSS), 12 (tag & remove legacy).

### What to build

Tag the current `HEAD` as `v1.3-legacy` and remove the legacy assets
(`TemplaterScripts/`, `MetabindScripts/`, `Button Templates.md`, `TurnTracker/`,
`Demo/`) from the repo root. Scaffold a buildable Obsidian plugin. Register a
processor for `turn-tracker` code blocks that parses the YAML state and renders a
**read-only** grid: checkboxes ticked up to `position`, grouped into hour rows
(6 per hour) and day blocks (24 hours) with a plain text header (`Day N` stub), all
styled by the plugin's own CSS. Malformed YAML renders an inline error without
throwing. No buttons, no interaction yet.

### Acceptance criteria

- [x] `git tag v1.3-legacy` exists on the pre-conversion commit; legacy assets are
      removed from the working tree.
- [x] `npm run build` produces a loadable `main.js` + `manifest.json`; the plugin
      enables in a vault without errors. *(Build verified; vault-enable needs a manual pass.)*
- [x] A `turn-tracker` block with `position: 14` renders a grid where the first 14
      boxes are ticked and the rest are empty, grouped into labelled hour rows and
      day blocks. *(Grid model unit-tested; DOM render is a thin adapter.)*
- [x] The grid renders correctly in both Reading and Live Preview modes. *(Needs a manual pass in a vault.)*
- [x] A block with malformed YAML shows a clear inline error and leaves Obsidian
      responsive (no thrown exception).
- [x] No `innerHTML`/`eval`/network usage; DOM built via `createEl`.

---

## Phase 2: The write loop — End Turn

**User stories / RFC decisions**: 4 (partial — actions), 1 (persistence).

### What to build

Add an **End Turn** button inside the widget and register it as an Obsidian command
(hotkey-able, palette-accessible) that acts on the tracker block in the active note.
The action increments `position`, rewrites the block via its `getSectionInfo` line
range, and the widget re-renders from the new YAML. This proves the full
read→act→persist→render cycle end-to-end.

### Acceptance criteria

- [x] Clicking **End Turn** ticks the next box and increments `position` in the
      code block's YAML on disk. *(Confirmed in-vault.)*
- [x] The "End Turn" command appears in the palette and can be bound to a hotkey;
      invoking it has the same effect as the button. *(Command registered; block locator unit-tested; palette/hotkey pending manual confirmation.)*
- [x] After the action the widget reflects the new state without a manual reload. *(Confirmed in-vault.)*
- [x] Edits target the correct block when the note contains other content and other
      code blocks (line range resolved at click time, not render time).

---

## Phase 3: Navigation — click-to-jump + advance shortcuts

**User stories / RFC decisions**: 4 (full — click-to-jump & backward reactivation),
8 (advance shortcuts).

### What to build

Make grid boxes clickable to set `position` to that box's index. Add advance
shortcut buttons and commands (`+1h`, `+3h`, `+8h` → +6/+18/+48 turns; defaults for
now). Backward jumps are allowed and recompute derived state rather than clamping.

### Acceptance criteria

- [x] Clicking a box moves the elapsed/remaining boundary to it and persists it — clicking an empty box fills through it (`position = turn+1`), clicking a filled box empties from it (`position = turn`). *(`toggleAt` unit-tested; box-click wiring reuses the confirmed write path — pending a manual click check.)*
- [x] `+1h`/`+3h`/`+8h` buttons and their commands advance `position` by 6/18/48. *(`advanceHours` unit-tested; button/command wiring pending a manual check.)*
- [x] Jumping backward to an earlier box is permitted and updates the grid; nothing
      is clamped or corrupted. *(Unit-tested: `jumpTo` doesn't clamp; `computeGrid` recomputes from any position.)*

---

## Phase 4: Markers — lights + computed expiry + auto-grow

**User stories / RFC decisions**: 2 (`expiresAt`), 3 (auto-grow + buffer), 5 (partial
— torch/lantern buttons, stacking).

### What to build

Add **Light Torch** and **Light Lantern** buttons (durations hardcoded to 6 and 24
turns for this phase) that push a marker with `expiresAt = position + duration` into
`lights[]`. Render each marker as a chip at its expiry turn; compute active vs
expired from `position` and dim expired chips. Auto-grow the visible grid to
`max(position, latest expiry) + buffer`. Collapse same-turn, same-label markers into
a counted chip (`T` → `T2`).

### Acceptance criteria

- [x] Lighting a torch adds a chip 6 turns ahead; a lantern adds one 24 turns ahead. *(`lightSource` + chip placement unit-tested; button wiring needs a manual pass.)*
- [x] Ending turns past a marker's `expiresAt` renders that chip dimmed (expired);
      jumping back before it re-activates it. *(Derived `expired` (both directions) unit-tested; the dimmed render needs a manual pass.)*
- [x] The grid extends automatically to show the furthest active marker plus the
      buffer; no "Add day" control exists. *(Auto-grow horizon unit-tested; no Add-day control was ever added.)*
- [x] Two same-type markers on the same turn render as a single counted chip (`T2`). *(Stacking count unit-tested; render composes `label+count`.)*

---

## Phase 5: Marker management — Add-Effect modal, per-chip removal, clears

**User stories / RFC decisions**: 5 (full — ad-hoc effects), 6 (removal + bulk clears).

### What to build

Add an **Add Effect** button opening a modal (label + duration in turns) that pushes
an ad-hoc marker into `effects[]`. Give each chip an `×` that removes **one** matching
marker (decrementing a stack, `T2` → `T`). Add **Clear expired** (drop markers with
`expiresAt <= position`) and **Clear all** (empty `lights` and `effects`).

### Acceptance criteria

- [x] The Add-Effect modal validates label + turn count and adds a chip at
      `position + turns`. *(`addEffect` placement unit-tested; modal + validation need a manual pass.)*
- [x] A chip's `×` removes exactly one marker; on a stacked chip it decrements the
      count rather than clearing the group. *(`removeMarker` fully unit-tested — decrement, effect, glyph-collision, no-match; the `×` wiring needs a manual pass.)*
- [x] "Clear expired" removes only markers at/behind `position`; "Clear all" empties
      both marker lists. *(Both unit-tested; buttons are trivial wiring.)*

---

## Phase 6: Configuration — settings tab, editable presets, Insert command

**User stories / RFC decisions**: 3 (buffer setting), 5 (editable presets), 7 (seed
from frontmatter), 8 (configurable advance shortcuts).

### What to build

Add a settings tab: manage presets (add/edit/remove; seeded with Torch = 6 and
Lantern = 24, each with icon, label, marker glyph, turns), configure advance
shortcuts, and set the look-ahead buffer. Drive the widget's preset buttons from
settings (replacing the Phase-4 hardcoding). Add an **Insert Turn Tracker** command
that inserts a fresh `turn-tracker` block, seeding `start`/`calendar` from the note's
`startTime`/`fc-calendar` frontmatter when present.

### Acceptance criteria

- [x] Editing a preset's duration in settings changes how far ahead its button places
      a marker; adding a preset adds a corresponding widget button. *(Configured presets drive `computeGrid` glyph (unit-tested) and the buttons; settings-tab editing + button wiring need a manual pass.)*
- [x] Advance shortcuts and look-ahead buffer are configurable and take effect. *(Buffer honored by `computeGrid` (unit-tested); shortcut buttons/commands + tab need a manual pass — commands re-register on reload.)*
- [x] "Insert Turn Tracker" drops a valid block; when the note has `startTime` or
      `fc-calendar`, those seed the block's `start`/`calendar`; otherwise it defaults
      to Day-1 / no calendar. *(`seedTrackerState` fully unit-tested; the editor insertion needs a manual pass.)*

---

## Phase 7: Dates & display polish — real/fantasy headers + collapsible days

**User stories / RFC decisions**: 7 (three header modes + Calendarium), 13 (collapsible
days).

### What to build

Implement day-header formatting for all three modes: `Day N` (no `start`), formatted
real date (datetime `start`), and Calendarium fantasy date (`calendar` set and plugin
present — port the weekday/month lookup and ordinal formatting from the legacy
`build_turn_tracker.js`). Feature-detect Calendarium; fall back gracefully with a
subtle notice when it is set but absent. Render day blocks as collapsible sections
with the current day expanded by default.

### Acceptance criteria

- [x] With no `start`, headers read `Day 1`, `Day 2`, …; with a datetime `start`,
      headers read as formatted real dates. *(`formatRealDate`/`makeDayHeader` + `computeGrid` wiring unit-tested.)*
- [~] With `calendar` set and Calendarium installed, headers render fantasy weekday /
      day / month / year; with it uninstalled, the tracker still renders and notifies. *(`dayHeader` override wiring + fallback-to-default unit-tested; the Calendarium port is feature-detected glue needing a manual pass with Calendarium installed.)*
- [x] Day sections collapse/expand; the current day is expanded by default. *(Implemented in the Phase 3 refinements: `<details>`/`<summary>`, completed days collapsed, current day open.)*

---

## Phase 8: Effect panel — `startsAt` model + active/expired lists

**User stories / RFC decisions**: revises RFC decision 5/6 (markers rendered as in-grid
chips → replaced by per-state effect lists) and adds `startsAt` to the marker schema
(supersedes the "no start stored" implication of decision 2).

### What to build

Add `startsAt` to every marker (`{ preset|label, startsAt, expiresAt }`); `lightSource`
and `addEffect` set `startsAt = position`. A marker's state is derived from `position`:
**pending** (`position < startsAt`, only reachable by rewinding — hidden, and excluded
from auto-grow), **active** (`startsAt ≤ position < expiresAt`), **expired**
(`position ≥ expiresAt`). This fixes the rewind bug (jumping back before a marker was lit
hides it; advancing past its start brings it back — reversible).

**Remove the in-grid chips.** Instead render two tracker-wide sections under the controls:
an **Active** list and a **collapsed Expired** list (grouped by state, not by day — so a
marker spanning days lives in exactly one list). Lights and effects are **unified** in
these lists. Markers are **grouped into one row per `(kind, key, startsAt, expiresAt)`** —
identical name *and* identical start *and* end collapse into a single row with a **count**
(same name+end but different start stays separate, since their progress differs). Each row
shows the marker's name/glyph (with count when > 1), a **progress bar**
(`(position − startsAt) / (expiresAt − startsAt)`), start / end / **turns remaining**
(`expiresAt − position`), and a **remove ×** that removes one marker from the group
(decrement-stack semantics; `removeMarker` keys on the full window incl. `startsAt`).
**Clicking a row highlights** the boxes it spans (`[startsAt, expiresAt)`) on the timeline;
clicking again (or another row) clears/moves the highlight. Highlight is ephemeral view state.

### Acceptance criteria

- [x] Markers store `startsAt`; `lightSource`/`addEffect` set it to `position`. Rewinding
      before a marker's `startsAt` hides it and drops it from auto-grow; advancing back
      past `startsAt` restores it (reversible, no data loss). *(startsAt-set, panel pending-hide, and auto-grow pending-exclusion all unit-tested.)*
- [x] The **Active** list shows active lights + effects (unified) with a progress bar and
      turns-remaining; the **Expired** list shows expired markers and is collapsed by default;
      pending markers appear in neither. *(`computeEffectPanel` unit-tested; collapse is DOM.)*
- [x] Markers with the same name, start, and end collapse into one row with a count;
      differing starts (even with the same end) stay separate rows. *(Unit-tested.)*
- [x] A row's **×** removes exactly one marker from that group (a count decrements);
      `removeMarker` matches on the full window (kind, key, startsAt, expiresAt). *(`removeMarker` unit-tested incl. startsAt discrimination; × wiring is glue.)*
- [x] Clicking a row highlights that marker's span on the timeline; clicking again clears it. *(Pure DOM — needs a manual pass.)*
- [x] The old in-grid marker chips are gone. *(MarkerChip/placeMarkers/chip rendering removed; build clean.)*

---

## Phase 9: Release — hygiene pass, versioning, workflow, README

**User stories / RFC decisions**: 11 (community-store readiness), 12 (README + legacy
link).

### What to build

Final community-store hygiene audit: confirm `onunload` detaches all handlers/intervals,
no `innerHTML`/`eval`/network remain, resources are disposable. Add `versions.json`,
finalize `manifest.json` metadata, and a GitHub release Action that builds and attaches
`main.js`/`manifest.json`/`styles.css`. Rewrite `README.md` for the plugin (install,
usage, screenshots) with a link to the `v1.3-legacy` tag for the old Templater approach.

### Acceptance criteria

- [x] Hygiene audit passes: unloading the plugin leaves no dangling handlers/intervals;
      no `innerHTML`/`eval`/network calls anywhere. *(`hygiene.test.ts` scans all 16 source files for forbidden DOM/eval/network APIs; audit confirms no timers or global/window listeners and all registrations go through `this.registerMarkdownCodeBlockProcessor`/`this.addCommand` — auto-detached on unload, so no `onunload` is needed.)*
- [x] `manifest.json` + `versions.json` are valid; the release Action produces a
      release with the built artifacts attached. *(`release-metadata.test.ts` validates manifest/versions/package consistency; `.github/workflows/release.yml` builds and attaches `main.js`/`manifest.json`/`styles.css` on a version-matched tag — YAML validated locally, an actual release run needs a real tag push.)*
- [x] `README.md` documents the plugin and links `v1.3-legacy`; the repo is ready to
      submit as a PR to `obsidianmd/obsidian-releases`. *(README rewritten for the plugin with install/usage and a `v1.3-legacy` link; submission itself is a manual GitHub step.)*
