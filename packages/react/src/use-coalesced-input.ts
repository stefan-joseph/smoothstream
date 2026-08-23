import { useEffect, useRef, useState } from "react";

interface CoalescedInput {
  readonly receiving: boolean;
  readonly source: string;
}

/**
 * Keeps rapid Markdown updates cheap while preserving the latest append-only
 * snapshot. At most one new snapshot is published per browser frame.
 */
export const useCoalescedInput = (
  source: string,
  receiving: boolean,
): CoalescedInput => {
  const [coalesced, setCoalesced] = useState<CoalescedInput>({
    receiving,
    source,
  });
  const latestInputRef = useRef<CoalescedInput>({ receiving, source });
  const latestSourceRef = useRef(source);
  const frameRef = useRef<number | null>(null);

  if (!source.startsWith(latestSourceRef.current)) {
    throw new Error(
      "Smoothstream Markdown must be append-only. Remount the component to render a different response.",
    );
  }
  latestSourceRef.current = source;
  latestInputRef.current = { receiving, source };

  useEffect(() => {
    if (
      coalesced.source === source &&
      coalesced.receiving === receiving
    ) {
      return;
    }
    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const latest = latestInputRef.current;
      setCoalesced((current) =>
        current.source === latest.source &&
        current.receiving === latest.receiving
          ? current
          : latest,
      );
    });
  }, [coalesced.receiving, coalesced.source, receiving, source]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
  }, []);

  return coalesced;
};
