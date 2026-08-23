export type CodeTokenStyle = Readonly<Record<string, number | string>>;

export interface CodeHighlightToken {
  /** Exact source text represented by this token. */
  readonly content: string;
  /** Trusted presentation properties supplied by the installed highlighter. */
  readonly style?: CodeTokenStyle;
}

export interface CodeHighlightLine {
  /** Ordered tokens whose content concatenates to the complete source line. */
  readonly tokens: ReadonlyArray<CodeHighlightToken>;
}

export interface CodeHighlightPalette {
  /** Background color for the fenced code surface. */
  readonly backgroundColor?: string;
  /** Default foreground color inherited by unstyled code tokens. */
  readonly color?: string;
  /** Trusted presentation properties supplied by the installed highlighter. */
  readonly style?: CodeTokenStyle;
}

export interface CodeHighlightResult {
  /** Highlighted lines in the same order as the requested source. */
  readonly lines: ReadonlyArray<CodeHighlightLine>;
  /**
   * Optional user-facing language name. Returning it allows a renderer adapter
   * to show an enhanced code-block toolbar for this fence.
   */
  readonly languageLabel?: string;
  /** Optional stable palette to apply before the first line is revealed. */
  readonly palette?: CodeHighlightPalette;
}

export interface CodeHighlightRequest {
  /** Complete committed code lines, including their terminating newlines. */
  readonly code: string;
  /** Normalized language identifier from the Markdown fence. */
  readonly language: string;
  /**
   * Opaque identity that remains stable while the same fenced block grows.
   * Highlighters may use it to retain incremental grammar state without
   * risking collisions between separate Smoothstream instances.
   */
  readonly session: object;
}

/**
 * Framework-neutral syntax-highlighting boundary.
 *
 * Implementations must only resolve lines whose tokenization is stable for
 * append-only input. Smoothstream does not recolor a line after it becomes visible.
 */
export interface CodeHighlighter {
  readonly name: string;
  highlight(
    request: CodeHighlightRequest,
  ): CodeHighlightResult | Promise<CodeHighlightResult>;
  supportsLanguage?(language: string): boolean;
}
