import {
  createElement,
  Fragment,
  memo,
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  StreamingSession,
  unitsReadyForCodeHighlights,
  type ImageDescriptor,
  type StreamingPlaybackSnapshot,
} from "@smoothstream/core";
import { browserClock } from "./clock";
import {
  createHastRenderCache,
  renderHast,
} from "./render-hast";
import type {
  SmoothstreamMode,
  SmoothstreamProps,
  SmoothstreamReveal,
} from "./types";
import { useAnimationPhase } from "./use-animation-phase";
import { useCodeHighlighting } from "./use-code-highlighting";
import { useCoalescedInput } from "./use-coalesced-input";
import { useImageReadiness } from "./use-image-readiness";
import { useReducedMotion } from "./use-reduced-motion";

const COMPLETION_ANNOUNCEMENT = "Content ready.";
const NO_IMAGES: ReadonlyArray<ImageDescriptor> = [];
const screenReaderOnlyStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
};

interface SmoothstreamPlaybackProps extends Omit<SmoothstreamProps, "children"> {
  duration: number;
  interval: number;
  mode: SmoothstreamMode;
  motionDisabled: boolean;
  reveal: SmoothstreamReveal;
  source: string;
}

const SmoothstreamPlayback = memo(({
  className,
  codeHighlighter,
  duration,
  receiving = false,
  interval,
  mode,
  motionDisabled,
  reducedMotion = "system",
  reveal,
  source,
  unstyled = false,
}: SmoothstreamPlaybackProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<StreamingSession | null>(null);
  const announcedSourceRef = useRef<string | null>(null);
  const [announcerMounted, setAnnouncerMounted] = useState(false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState("");
  const [playback, setPlayback] = useState<StreamingPlaybackSnapshot>({
    animationComplete: true,
    immediate: false,
    now: 0,
    schedules: new Map(),
    visibleUnitCount: 0,
  });

  if (!sessionRef.current) {
    sessionRef.current = new StreamingSession(browserClock, {
      duration,
      interval,
    });
  }
  const session = sessionRef.current;

  const preparedInput = useMemo(
    () => session.prepareInput(source, receiving, reveal),
    [receiving, reveal, session, source],
  );
  const { plan } = preparedInput;
  const renderCache = useMemo(createHastRenderCache, [preparedInput]);
  const codeHighlighting = useCodeHighlighting(
    preparedInput.codeBlocks,
    codeHighlighter,
  );
  const presentationImmediate = motionDisabled || mode === "static";
  const playbackUnits = useMemo(
    () => presentationImmediate
      ? plan.units
      : unitsReadyForCodeHighlights(
        plan.units,
        codeHighlighter,
        codeHighlighting.highlights,
      ),
    [
      codeHighlighter,
      codeHighlighting.highlights,
      plan.units,
      presentationImmediate,
    ],
  );
  const playbackUnitSignature = playbackUnits.map((unit) => unit.id).join("|");
  const immediate = useMemo(
    () => presentationImmediate
      ? session.immediate(preparedInput, playbackUnits)
      : undefined,
    [playbackUnits, preparedInput, presentationImmediate, session],
  );
  const revealDuration = presentationImmediate ? 0 : duration;
  const imageReadiness = useImageReadiness(
    presentationImmediate ? NO_IMAGES : preparedInput.images,
    revealDuration,
  );
  const imageReadinessSignature = [...imageReadiness.images]
    .map(([id, readiness]) => `${id}:${readiness.status}:${readiness.readyAt}`)
    .join("|");
  const activePlayback = immediate ?? playback;
  const renderNow = Math.max(activePlayback.now, imageReadiness.now);
  const presentation = session.present(
    preparedInput,
    activePlayback,
    {
      now: renderNow,
    },
  );

  useEffect(() => {
    session.commitInput(preparedInput);
  }, [preparedInput, session]);

  useEffect(() => {
    if (mode === "streaming") {
      setAnnouncerMounted(true);
    }
  }, [mode]);

  useEffect(() => {
    if (presentationImmediate) {
      return;
    }

    const snapshot = session.schedule(preparedInput, playbackUnits);
    let visibleCount = snapshot.visibleUnitCount;
    setPlayback(snapshot);

    if (snapshot.schedules.size === 0) {
      return;
    }

    let frameId = 0;
    let finalCompletionPublished = false;

    const frame = () => {
      const next = session.advance();
      const previousVisibleCount = visibleCount;
      visibleCount = next.visibleUnitCount;
      const completed = next.animationComplete;

      if (
        visibleCount !== previousVisibleCount ||
        (completed && !finalCompletionPublished)
      ) {
        finalCompletionPublished = completed;
        setPlayback(next);
      }

      if (!completed) {
        frameId = requestAnimationFrame(frame);
      }
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [playbackUnitSignature, presentationImmediate]);

  const content = renderHast(
    plan.tree,
    presentation.schedules,
    presentation.now,
    presentation.compactedUnitIds,
    imageReadiness.images,
    renderCache,
    presentation.visibleUnitCount,
    plan.units,
    presentation.compactedBlockIds,
    codeHighlighting.highlights,
    codeHighlighting.revision,
    reveal,
    presentationImmediate,
    codeHighlighter !== undefined,
    codeHighlighter?.showLanguageLabels !== false,
    plan.confirmedBlockIds,
  );

  useAnimationPhase(rootRef);

  useEffect(() => {
    if (mode === "static" || !announcerMounted) {
      return;
    }

    if (
      receiving ||
      (announcedSourceRef.current !== null &&
        announcedSourceRef.current !== source)
    ) {
      announcedSourceRef.current = null;
      setCompletionAnnouncement("");
      return;
    }

    const root = rootRef.current;
    const hasContent = plan.tree.children.length > 0;
    const hasTemporaryUnits =
      root?.querySelector("[data-smoothstream-unit]") !== null;
    if (
      !root ||
      !hasContent ||
      !presentation.allPlannedUnitsCompacted ||
      hasTemporaryUnits ||
      announcedSourceRef.current === source
    ) {
      return;
    }

    announcedSourceRef.current = source;
    setCompletionAnnouncement(COMPLETION_ANNOUNCEMENT);
  }, [
    announcerMounted,
    mode,
    presentation.allPlannedUnitsCompacted,
    imageReadinessSignature,
    receiving,
    plan.tree.children.length,
    renderNow,
    source,
  ]);

  const announcer = mode === "streaming" && announcerMounted &&
      typeof document !== "undefined"
    ? createPortal(
      createElement(
        "div",
        {
          "aria-atomic": true,
          "aria-live": "polite",
          "data-smoothstream-announcer": true,
          role: "status",
          style: screenReaderOnlyStyle,
        },
        completionAnnouncement,
      ),
      document.body,
    )
    : null;

  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      {
        className,
        "data-smoothstream": true,
        "data-smoothstream-mode": mode,
        "data-smoothstream-theme": unstyled ? undefined : "default",
        "data-smoothstream-motion": motionDisabled ? "none" : "animate",
        "data-smoothstream-reduced-motion": reducedMotion,
        "data-smoothstream-reveal": reveal,
        ref: rootRef,
        style: {
          "--smoothstream-duration": `${motionDisabled ? 0 : duration}ms`,
          "--smoothstream-interval": `${motionDisabled ? 0 : interval}ms`,
        } as CSSProperties,
      },
      content,
    ),
    announcer,
  );
});

const markdownFromChildren = (children: unknown): string => {
  if (typeof children === "string") {
    return children;
  }
  if (children == null || typeof children === "boolean") {
    return "";
  }
  if (Array.isArray(children)) {
    const markdown = children.filter(
      (child): child is string => typeof child === "string" && child.trim() !== "",
    );
    if (markdown.length === 0) {
      return "";
    }
    if (markdown.length === 1) {
      const [only] = markdown;
      if (only !== undefined) {
        return only;
      }
    }
  }
  throw new Error("Smoothstream children must be a Markdown string.");
};

export const Smoothstream = (
  props: SmoothstreamProps,
): ReactElement => {
  const duration = props.duration ?? 1_000;
  const interval = props.interval ?? 3;
  const mode = props.mode ?? "streaming";
  const reveal = props.reveal ?? "character";
  const resolvedMotion = useReducedMotion(props.reducedMotion ?? "system");
  const input = useCoalescedInput(
    markdownFromChildren(props.children),
    props.receiving ?? false,
  );

  if (resolvedMotion === "pending" && mode === "streaming") {
    return createElement("div", {
      className: props.className,
      "data-smoothstream": true,
      "data-smoothstream-mode": mode,
      "data-smoothstream-theme": props.unstyled ? undefined : "default",
      "data-smoothstream-motion": "pending",
      "data-smoothstream-reduced-motion": "system",
      "data-smoothstream-reveal": reveal,
      style: {
        "--smoothstream-duration": `${duration}ms`,
        "--smoothstream-interval": `${interval}ms`,
      } as CSSProperties,
    });
  }

  const { children: _children, ...playbackProps } = props;
  return createElement(SmoothstreamPlayback, {
    ...playbackProps,
    duration,
    receiving: input.receiving,
    interval,
    key: `${interval}:${duration}:${mode}:${reveal}`,
    mode,
    motionDisabled: resolvedMotion === "none",
    reveal,
    source: input.source,
  });
};
