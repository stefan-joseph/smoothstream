import type { Root as HastRoot } from "hast";
import type { RevealUnit } from "../types";

export type MarkdownReveal = "character" | "word";

export interface SourceRange {
  readonly end: number;
  readonly start: number;
}

export type MarkdownRevealKind =
  | "block"
  | "code-line"
  | "heading"
  | "image"
  | "inline"
  | "link"
  | "list-item"
  | "table-row"
  | "text";

export interface MarkdownRevealUnit extends RevealUnit {
  readonly blockId: string;
  readonly kind: MarkdownRevealKind;
  readonly sourceRange: SourceRange;
  readonly value: string;
}

export interface MarkdownPlan {
  /** Blocks whose Markdown structure can no longer change as input is appended. */
  readonly confirmedBlockIds: ReadonlySet<string>;
  readonly tree: HastRoot;
  readonly units: ReadonlyArray<MarkdownRevealUnit>;
}
