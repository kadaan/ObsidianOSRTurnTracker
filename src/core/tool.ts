/**
 * The tool-agnostic contract the plugin host drives. Each tool is a self-contained
 * `ToolModule`: a fence language, a `BlockCodec` (its parse/serialize pair), and a
 * `render` that builds its widget from a `RenderContext`. The host owns persistence
 * (locate → apply → write) and hands each render a single `mutate` bridge.
 */

export type ParseResult<S> = { ok: true; state: S } | { ok: false; error: string };

/** A tool's block schema, as a pure parse/serialize pair. `parse` is total — it never throws. */
export interface BlockCodec<S> {
  parse(source: string): ParseResult<S>;
  serialize(state: S): string;
}

/** The note a block lives in, for tools that seed/validate block state against it before render. */
export interface NoteContext {
  frontmatter: Record<string, unknown> | undefined;
}

/** What a tool's `render` receives. `mutate` runs the shared write pipeline for this block. */
export interface RenderContext<S> {
  container: HTMLElement;
  state: S;
  /** Path of the note this block is in, so a tool can read live note context (e.g. frontmatter). */
  sourcePath: string;
  /** Persist a block-local transform: locate the block, parse, transform, serialize, splice, write. */
  mutate(transform: (state: S) => S): void;
  renderMarkdown(el: HTMLElement, text: string): void;
  /** The hotkey a user assigned to `commandId` for this tool (or undefined), for quiet button hints. */
  hotkeyLabel(commandId: string): string | undefined;
}

/** A tool packaged for the host: identity, its codec, its renderer, and optional lifecycle hooks. */
export interface ToolModule<S> {
  /** Stable id; also the command-namespace prefix (`<id>:<command>`). */
  id: string;
  /** Fenced code-block language this tool renders (usually === id). */
  lang: string;
  displayName: string;
  codec: BlockCodec<S>;
  /**
   * Resolve/validate parsed block state against the note before render. Returns the state to render,
   * or an error to show inline. May call `backfill` to persist seeded values (the host guards the
   * write, e.g. reading-mode only).
   */
  prepare?(
    state: S,
    note: NoteContext,
    backfill: (transform: (state: S) => S) => void,
  ): { state: S } | { error: string };
  render(ctx: RenderContext<S>): void;
  /** Runs after a successful write, for side effects (e.g. Calendarium day sync). */
  afterWrite?(before: S, after: S): void | Promise<void>;
}
