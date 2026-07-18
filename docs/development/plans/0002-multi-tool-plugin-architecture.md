# Plan: Multi-Tool Plugin Architecture

> Source PRD: docs/development/rfcs/0002-multi-tool-plugin-architecture.md

> **Scope note**: This plan covers the multi-tool foundation and the first new tool
> (charge tracker). The **XP tracker** (RFC Tool 2) is intentionally deferred — it is
> complex enough to warrant its own PRD/plan and will be planned separately once this
> foundation lands.

## Architectural Decisions

Durable decisions that apply across all phases:

- **Prerequisite (done, uncommitted)**: plugin renamed to **OSR Tools** (id
  `osr-tools`). Not a phase.
- **Registry**: a `TOOLS: ToolModule[]` array; the host registers one
  `MarkdownCodeBlockProcessor` per tool. `main.ts` is a thin host.
- **`ToolModule<S>`**: `{ id, lang, displayName, codec: { parse, serialize },
  render, commands?, insert?, settingsSection?, afterWrite? }`. Each tool is a
  self-contained module under `tools/<id>/` exporting one `ToolModule`.
- **`RenderContext<S>`**: carries `state`, the tool's `settings` slice, and a single
  `mutate(transform: (s: S) => S)` bridge that runs the shared write pipeline.
  Replaces the turn tracker's flat `TrackerHandlers` (rebuilt internally from
  `mutate`, behavior unchanged).
- **State model**: every tool is **block-local and self-contained**. No global or
  campaign-wide shared state. All writes go through the single funnel
  (`applyToFile` + re-entrancy guard + click-time `getSectionInfo` block location).
- **Codec contract**: `parse` is pure and total — returns `{ ok, state } | { ok:
  false, error }`, never throws; rejects unknown top-level keys; renders inline
  errors with the raw block still visible. Legacy migration lives inside each tool's
  `parse`.
- **Fence languages**: `turn-tracker` (frozen), `charge-tracker`. (`xp-tracker`
  reserved for the deferred XP tool.)
- **Layout**: `core/` (host infrastructure — fence match, apply, write funnel,
  registry types), `ui/` (shared widget kit), `tools/<id>/` (per-tool modules).
- **Namespacing**: CSS `osr-tt-` (frozen), `osr-charge-`; Obsidian commands
  `<toolId>:<cmd>`.
- **Frozen for back-compat**: the `turn-tracker` fence language, the `osr-tt-` CSS
  prefix, and the `osrtt-ingame-date` frontmatter property.
- **UI kit extraction is pull, not push**: shared widgets are lifted into `ui/` only
  when a second tool consumes them, not speculatively.

---

## Phase 1: Tool-host foundation, turn tracker as the first module

**User stories**: As a plugin maintainer, I can register multiple tools from a single
registry, each rendered as its own code block, with all persistence flowing through
one shared pipeline — proven end-to-end by the turn tracker running unchanged through
the new host.

**Blocked by**: none. *(Risk gate — land before any new tool.)*

### What to build

Generalize the existing single-tool pipeline into a tool-agnostic host and convert
the turn tracker to be the first `ToolModule` driven by it. When complete, the turn
tracker looks and behaves exactly as it does today, but every layer beneath it —
fence matching, parse/serialize, the write funnel, settings, and commands — is driven
through the generic `ToolModule` / `RenderContext` interfaces rather than
turn-tracker-specific code. The fence-matching and apply logic take the tool's
language and codec as inputs; the Calendarium day-boundary side effect moves out of
the write funnel into the turn tracker's `afterWrite` hook, leaving the funnel
tool-neutral. Settings render as a per-tool section, and commands are contributed by
the tool and namespaced by the host.

### Acceptance criteria

- [x] A `ToolModule<S>` interface and a `RenderContext<S>` (with a single `mutate`
      bridge) exist in `core/`, and the host registers processors by looping a
      `TOOLS` array.
- [x] The find-and-replace-block logic and the `applyAction` pipeline accept the fence
      language and the tool's codec as parameters (no hardcoded `turn-tracker`).
- [x] The single write funnel (with its re-entrancy guard and click-time block
      location) is tool-neutral; the Calendarium side effect runs via the turn
      tracker's `afterWrite`, not inline in the funnel.
- [x] The turn tracker is expressed as one `ToolModule`
      (`createTurnTrackerTool`; physical relocation to `tools/turn-tracker/` deferred
      per the seams-now decision); its `render` builds its handlers from `ctx.mutate`.
- [x] The turn tracker's commands are contributed by the tool (`commands()`) and
      registered namespaced `turn-tracker:<cmd>` by the host (spec builder unit-tested).
- [~] Settings render via the tool's `settingsSection`. **Deferred to Phase 2** —
      pure reorganization with no benefit until a second tool has settings; pulled
      when the charge tracker adds its own section (per "pull, not push").
- [ ] Turn tracker behavior is unchanged in Reading and Live Preview modes (buttons,
      box clicks, hotkeys, insert command, copy-state, day headers, calendar sync).
- [x] All existing tests pass unchanged; the frozen `turn-tracker` language,
      `osr-tt-` CSS, and `osrtt-ingame-date` property are untouched.

---

## Phase 2: Charge tracker

**User stories**: As a player tracking a wand or staff, I can author a
`charge-tracker` block listing named items with current/max charges, see each as a
labelled progress bar, rename an item inline, click the count to set an exact value,
and add or spend a single charge with ± buttons — all persisted back into the block.

**Blocked by**: Phase 1.

### What to build

A new `charge-tracker` code block rendered end-to-end through the host from Phase 1.
State is a block-local list of items, each with a name and a current/max charge
count. Each row renders as a stepper (inline-editable name, click-to-set count, − and
+ buttons) over a progress bar filled `current / max`. Every interaction is a single
`ctx.mutate`. As this tool is built, the reusable progress-bar, inline-edit, and
stepper primitives are extracted from the turn tracker's existing panel code into the
shared `ui/` kit and consumed by both tools.

### Acceptance criteria

- [ ] A `charge-tracker` fenced block renders an interactive widget in Reading and
      Live Preview modes; malformed YAML shows an inline error with the raw block
      visible.
- [ ] Item state (`name`, `current`, `max`) round-trips through the tool's codec and
      the shared write funnel.
- [ ] A user can rename an item inline, click the count to set an exact value, and
      increment/decrement a single charge via buttons; the progress bar reflects
      `current / max`, clamped to `[0, max]`.
- [ ] Progress-bar, inline-edit, and stepper primitives live in `ui/` and are used by
      both the charge tracker and the (unchanged-behavior) turn tracker.
- [ ] Settings tab is split per-tool (pulled from Phase 1): a `settingsSection` hook on
      the host tool, the settings tab loops tools, and the turn tracker's existing
      section (presets, effect history, Calendarium, property fields) moves behind it
      unchanged — driven by the charge tracker needing its own section.
- [ ] New CSS is namespaced `osr-charge-`; the turn tracker's `osr-tt-` styles are
      untouched.
- [x] Tests cover the codec (parse/serialize round-trip, unknown-key rejection) and
      the charge transforms (set/increment/decrement/clamp).

---

## Deferred: XP tracker

The XP tracker/calculator (RFC Tool 2 — per-session loot, monster XP, 3d6-drop-lowest
Feats of Exploration, roster share division, Copy-forward) is **out of scope for this
plan**. It is complex enough to need its own PRD and plan. Once Phases 1–2 land, plan
it separately; it will slot in as an additional `ToolModule` (`xp-tracker`) on the
foundation built here, reusing the `ui/` kit and the shared write pipeline.

---

*To implement the first phase using TDD, run:*
`/tdd docs/development/plans/0002-multi-tool-plugin-architecture.md`
