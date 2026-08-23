import type { CodeHighlighter, MarkdownReveal } from "@smoothstream/core";

export type SmoothstreamMotion = "system" | "animate" | "none";
export type SmoothstreamReveal = MarkdownReveal;

export interface SmoothstreamOptions {
  className?: string;
  /** Optional syntax highlighter for fenced code blocks. */
  codeHighlighter?: CodeHighlighter;
  /** Milliseconds spent animating each revealed character or word. @default 1000 */
  duration?: number;
  /** Whether more Markdown may still arrive. */
  receiving?: boolean;
  /** Base cadence between presentation units, in milliseconds. @default 3 */
  interval?: number;
  /** Follow the operating system, always animate, or show content immediately. @default "system" */
  motion?: SmoothstreamMotion;
  /** Reveal flowing text by character or by complete word. @default "character" */
  reveal?: SmoothstreamReveal;
  /** Disable the default prose theme while retaining functional reveal styles. */
  unstyled?: boolean;
}

export interface SmoothstreamUpdateOptions {
  /** Whether more Markdown may still arrive. */
  receiving?: boolean;
}

export interface SmoothstreamController {
  /** Root element created inside the supplied container. */
  readonly element: HTMLDivElement;
  /** Remove the rendered root, listeners, pending work, and accessibility announcer. */
  destroy(): void;
  /** Queue the latest append-only Markdown snapshot for presentation. */
  update(markdown: string, options?: SmoothstreamUpdateOptions): void;
}
