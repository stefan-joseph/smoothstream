import { useEffect, useRef, useState } from "react";
import {
  codeBlockRequestKey,
  resolveCodeHighlight,
  type CodeBlockRequest,
  type CodeHighlighter,
  type ResolvedCodeHighlight,
} from "@smoothstream/core";

export interface CodeHighlightingSnapshot {
  readonly highlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  readonly revision: number;
}

interface CodeHighlightingState extends CodeHighlightingSnapshot {
  readonly highlighter: CodeHighlighter | undefined;
}

export const useCodeHighlighting = (
  requests: ReadonlyArray<CodeBlockRequest>,
  highlighter: CodeHighlighter | undefined,
): CodeHighlightingSnapshot => {
  const requestsByBlockRef = useRef(new Map<number, string>());
  const sessionsByBlockRef = useRef(new Map<number, object>());
  const [state, setState] = useState<CodeHighlightingState>({
    highlighter,
    highlights: new Map(),
    revision: 0,
  });

  useEffect(() => {
    requestsByBlockRef.current.clear();
    sessionsByBlockRef.current.clear();
    setState((current) => ({
      highlighter,
      highlights: new Map(),
      revision: current.revision + 1,
    }));
  }, [highlighter]);

  useEffect(() => {
    if (!highlighter || state.highlighter !== highlighter) {
      return;
    }

    for (const request of requests) {
      const key = codeBlockRequestKey(request);
      const current = state.highlights.get(request.blockStart);
      if (
        current?.language === request.language &&
        current.code === request.code
      ) {
        continue;
      }
      if (requestsByBlockRef.current.get(request.blockStart) === key) {
        continue;
      }
      requestsByBlockRef.current.set(request.blockStart, key);

      const pending = Promise.resolve(highlighter.highlight({
        code: request.code,
        language: request.language,
        session: sessionsByBlockRef.current.get(request.blockStart) ?? (() => {
          const session = {};
          sessionsByBlockRef.current.set(request.blockStart, session);
          return session;
        })(),
      }));

      void pending.then(
        (result) => {
          if (requestsByBlockRef.current.get(request.blockStart) !== key) {
            return;
          }
          setState((currentState) => {
            if (currentState.highlighter !== highlighter) {
              return currentState;
            }
            const highlights = new Map(currentState.highlights);
            highlights.set(
              request.blockStart,
              resolveCodeHighlight(
                request,
                result,
                currentState.highlights.get(request.blockStart),
              ),
            );
            return {
              highlighter,
              highlights,
              revision: currentState.revision + 1,
            };
          });
        },
        () => {
          if (requestsByBlockRef.current.get(request.blockStart) !== key) {
            return;
          }
          setState((currentState) => {
            if (currentState.highlighter !== highlighter) {
              return currentState;
            }
            const highlights = new Map(currentState.highlights);
            highlights.set(
              request.blockStart,
              resolveCodeHighlight(
                request,
                undefined,
                currentState.highlights.get(request.blockStart),
              ),
            );
            return {
              highlighter,
              highlights,
              revision: currentState.revision + 1,
            };
          });
        },
      );
    }
  }, [highlighter, requests, state.highlighter, state.highlights]);

  return state.highlighter === highlighter
    ? { highlights: state.highlights, revision: state.revision }
    : { highlights: new Map(), revision: state.revision };
};
