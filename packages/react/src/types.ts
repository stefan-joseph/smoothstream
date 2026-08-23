import type { CodeHighlighter, MarkdownReveal } from "@smoothstream/core";

export type SmoothstreamMotion = "system" | "animate" | "none";
export type SmoothstreamReveal = MarkdownReveal;

export interface SmoothstreamProps {
  /** Accumulated Markdown snapshot to present. */
  children?: string;
  className?: string;
  /** Optional syntax highlighter for fenced code blocks. */
  codeHighlighter?: CodeHighlighter;
  /** Milliseconds spent animating each revealed character or word. @default 1000 */
  duration?: number;
  /** Whether more Markdown may still arrive. */
  receiving?: boolean;
  /** Base cadence in milliseconds; word mode preserves it while grouping characters. @default 3 */
  interval?: number;
  /** Motion policy: follow the system, always animate, or always reduce. @default "system" */
  motion?: SmoothstreamMotion;
  /** Reveal flowing text by character or by complete word. @default "character" */
  reveal?: SmoothstreamReveal;
  /** Disable Smoothstream's default prose theme while retaining reveal and layout behavior. */
  unstyled?: boolean;
}
