export interface GraphemeSegment {
  /** UTF-16 offset after this grapheme in the containing string. */
  readonly end: number;
  /** UTF-16 offset of this grapheme in the containing string. */
  readonly start: number;
  readonly value: string;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

/** Split visible text without breaking emoji or combining-character sequences. */
export const segmentGraphemes = (value: string): GraphemeSegment[] =>
  Array.from(graphemeSegmenter.segment(value), (segment) => ({
    end: segment.index + segment.segment.length,
    start: segment.index,
    value: segment.segment,
  }));
