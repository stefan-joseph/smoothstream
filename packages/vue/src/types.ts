import type { CodeHighlighter, MarkdownReveal } from "@smoothstream/core";

export type SmoothstreamMode = "streaming" | "static";
export type SmoothstreamReducedMotion = "system" | "always" | "never";
export type SmoothstreamReveal = MarkdownReveal;

export interface SmoothstreamProps {
  /** Optional syntax highlighter for fenced code blocks. */
  codeHighlighter?: CodeHighlighter;
  /** Milliseconds spent animating each revealed character or word. @default 1000 */
  duration?: number;
  /** Base cadence in milliseconds; word mode preserves it while grouping characters. @default 3 */
  interval?: number;
  /** Accumulated Markdown snapshot to present. */
  markdown?: string;
  /** Progressively reveal streaming content or render completed Markdown immediately. @default "streaming" */
  mode?: SmoothstreamMode;
  /** Whether more Markdown may still arrive. */
  receiving?: boolean;
  /** Reduced-motion policy: follow the system preference, always reduce, or never reduce. @default "system" */
  reducedMotion?: SmoothstreamReducedMotion;
  /** Reveal flowing text by character or by complete word. @default "character" */
  reveal?: SmoothstreamReveal;
  /** Disable Smoothstream's default prose theme while retaining reveal and layout behavior. */
  unstyled?: boolean;
}
