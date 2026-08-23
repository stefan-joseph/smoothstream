export {
  collectCodeBlockRequests,
  codeBlockRequestKey,
  normalizeCodeHighlight,
  plainCodeLines,
  resolveCodeHighlight,
  unitsReadyForCodeHighlights,
} from "./code-highlighting";
export type {
  CodeBlockRequest,
  ResolvedCodeHighlight,
} from "./code-highlighting";
export { collectImageDescriptors } from "./images";
export type { ImageDescriptor, ImageReadiness } from "./images";
export { RevealScheduler } from "./scheduler";
export { StreamingSession } from "./session";
export type {
  StreamingInputSnapshot,
  StreamingPlaybackSnapshot,
  StreamingPresentationOptions,
  StreamingPresentationSnapshot,
} from "./session";
export type {
  MarkdownPlan,
  MarkdownReveal,
  MarkdownRevealKind,
  MarkdownRevealUnit,
  SourceRange,
} from "./markdown/types";
export {
  createCodeCharacterUnitId,
  createCodeLineUnitId,
  createRangeUnitId,
} from "./markdown/identity";
export { segmentGraphemes } from "./markdown/graphemes";
export type { GraphemeSegment } from "./markdown/graphemes";
export type {
  CodeHighlighter,
  CodeHighlightLine,
  CodeHighlightPalette,
  CodeHighlightRequest,
  CodeHighlightResult,
  CodeHighlightToken,
  CodeTokenStyle,
} from "./code-types";
export type {
  Clock,
  RevealUnit,
  ScheduledUnit,
  SchedulerOptions,
  SchedulerSnapshot,
} from "./types";
