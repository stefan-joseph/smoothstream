import type { MarkdownRevealKind, SourceRange } from "./types";

export const createRangeUnitId = (
  kind: MarkdownRevealKind,
  range: SourceRange,
): string => `${kind}:${range.start}:${range.end}`;

export const createCodeLineUnitId = (
  blockStart: number,
  lineIndex: number,
): string => `code-line:${blockStart}:${lineIndex}`;

export const createCodeCharacterUnitId = (
  blockStart: number,
  lineIndex: number,
  characterIndex: number,
): string => `code-character:${blockStart}:${lineIndex}:${characterIndex}`;
