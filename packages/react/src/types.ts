import type { CodeHighlighter, MarkdownReveal } from "@smoothstream/core";
import type { MarkdownComponentName } from "@smoothstream/core/web";
import type {
  ComponentPropsWithoutRef,
  ComponentType,
} from "react";

export type SmoothstreamMode = "streaming" | "static";
export type SmoothstreamReducedMotion = "system" | "always" | "never";
export type SmoothstreamReveal = MarkdownReveal;
export type SmoothstreamComponentName = MarkdownComponentName;

export type SmoothstreamComponentProps<
  Name extends SmoothstreamComponentName,
> = ComponentPropsWithoutRef<Name extends "inlineCode" ? "code" : Name>;

export type SmoothstreamComponents = {
  [Name in SmoothstreamComponentName]?: ComponentType<
    SmoothstreamComponentProps<Name>
  >;
};

export interface SmoothstreamProps {
  /** Accumulated Markdown snapshot to present. */
  children?: string;
  className?: string;
  /** React component overrides for semantic elements originating in Markdown. */
  components?: SmoothstreamComponents;
  /** Optional syntax highlighter for fenced code blocks. */
  codeHighlighter?: CodeHighlighter;
  /** Milliseconds spent animating each revealed character or word. @default 1000 */
  duration?: number;
  /** Whether more Markdown may still arrive. */
  receiving?: boolean;
  /** Base cadence in milliseconds; word mode preserves it while grouping characters. @default 3 */
  interval?: number;
  /** Progressively reveal streaming content or render completed Markdown immediately. @default "streaming" */
  mode?: SmoothstreamMode;
  /** Reduced-motion policy: follow the system preference, always reduce, or never reduce. @default "system" */
  reducedMotion?: SmoothstreamReducedMotion;
  /** Reveal flowing text by character or by complete word. @default "character" */
  reveal?: SmoothstreamReveal;
  /** Disable Smoothstream's default prose theme while retaining reveal and layout behavior. */
  unstyled?: boolean;
}
