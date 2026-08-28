import {
  codeBlockRequestKey,
  resolveCodeHighlight,
  StreamingSession,
  unitsReadyForCodeHighlights,
  type Clock,
  type CodeBlockRequest,
  type CodeHighlighter,
  type ImageDescriptor,
  type ImageReadiness,
  type ResolvedCodeHighlight,
  type StreamingInputSnapshot,
  type StreamingPlaybackSnapshot,
  type StreamingPresentationSnapshot,
} from "@smoothstream/core";
import {
  createWebPresentation,
  createWebPresentationCache,
  type WebPresentationCache,
} from "@smoothstream/core/web";
import {
  computed,
  defineComponent,
  Fragment,
  h,
  mergeProps,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  shallowRef,
  Teleport,
  ref,
  watch,
  type PropType,
  type VNode,
} from "vue";
import { webNodesToVue } from "./render-web";
import type {
  SmoothstreamMode,
  SmoothstreamReducedMotion,
  SmoothstreamReveal,
} from "./types";

const COMPLETION_ANNOUNCEMENT = "Content ready.";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PHASE_SELECTOR = "[data-smoothstream-animation-start]";
const PHASE_PROPERTY = "--smoothstream-animation-delay";

const screenReaderOnlyStyle = {
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
} as const;

const browserClock: Clock = {
  now: () =>
    typeof window === "undefined"
      ? 0
      : window.performance?.now() ?? Date.now(),
};

const emptyPlayback = (): StreamingPlaybackSnapshot => ({
  animationComplete: true,
  immediate: false,
  now: 0,
  schedules: new Map(),
  visibleUnitCount: 0,
});

interface PendingInput {
  readonly receiving: boolean;
  readonly source: string;
}

interface SynchronizedPhase {
  readonly delay: string;
  readonly duration: number;
  readonly startAt: number;
}

export const Smoothstream = defineComponent({
  name: "Smoothstream",
  inheritAttrs: false,
  props: {
    codeHighlighter: Object as PropType<CodeHighlighter | undefined>,
    duration: {
      default: 1_000,
      type: Number,
    },
    interval: {
      default: 3,
      type: Number,
    },
    markdown: {
      default: "",
      type: String,
    },
    mode: {
      default: "streaming",
      type: String as PropType<SmoothstreamMode>,
    },
    receiving: {
      default: false,
      type: Boolean,
    },
    reducedMotion: {
      default: "system",
      type: String as PropType<SmoothstreamReducedMotion>,
    },
    reveal: {
      default: "character",
      type: String as PropType<SmoothstreamReveal>,
    },
    unstyled: {
      default: false,
      type: Boolean,
    },
  },
  setup(props, { attrs }) {
    const root = ref<HTMLDivElement | null>(null);
    const mounted = ref(false);
    const motionDisabled = ref(props.reducedMotion === "always");
    const currentInput = shallowRef<StreamingInputSnapshot>();
    const currentPlayback = shallowRef<StreamingPlaybackSnapshot>(
      emptyPlayback(),
    );
    const codeHighlights = shallowRef<ReadonlyMap<number, ResolvedCodeHighlight>>(
      new Map(),
    );
    const imageReadiness = shallowRef<ReadonlyMap<string, ImageReadiness>>(
      new Map(),
    );
    const resourceNow = ref(0);
    const completionAnnouncement = ref("");

    let session = new StreamingSession(browserClock, {
      duration: props.duration,
      interval: props.interval,
    });
    let presentationCache: WebPresentationCache = createWebPresentationCache();
    let lastPresentation: StreamingPresentationSnapshot | undefined;
    let requestedSource = props.markdown;
    let pendingInput: PendingInput | undefined = {
      receiving: props.receiving,
      source: props.markdown,
    };
    let inputFrame: number | undefined;
    let playbackFrame: number | undefined;
    let mediaQuery: MediaQueryList | undefined;
    let destroyed = false;
    let announcedSource: string | undefined;
    let completionRendered = false;

    const codeRequestsByBlock = new Map<number, string>();
    const codeSessionsByBlock = new Map<number, object>();
    const imageLoaders = new Map<string, HTMLImageElement>();
    const resourceTimers = new Set<number>();
    const synchronizedPhases = new WeakMap<HTMLElement, SynchronizedPhase>();
    let phasedElements = new Set<HTMLElement>();

    const resolvedMotion = computed<"pending" | "animate" | "none">(() => {
      if (props.reducedMotion === "always") return "none";
      if (props.reducedMotion === "never") return "animate";
      if (!mounted.value) return "pending";
      return motionDisabled.value ? "none" : "animate";
    });

    const presentationImmediate = (): boolean =>
      props.mode === "static" || resolvedMotion.value === "none";

    const requestFrame = (callback: FrameRequestCallback): number =>
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(callback)
        : window.setTimeout(() => callback(browserClock.now()), 16);

    const cancelFrame = (frame: number): void => {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      } else {
        window.clearTimeout(frame);
      }
    };

    const playbackUnits = (
      input: StreamingInputSnapshot,
    ) => presentationImmediate()
      ? input.plan.units
      : unitsReadyForCodeHighlights(
        input.plan.units,
        props.codeHighlighter,
        codeHighlights.value,
      );

    const cancelPlaybackFrame = (): void => {
      if (playbackFrame === undefined || typeof window === "undefined") return;
      cancelFrame(playbackFrame);
      playbackFrame = undefined;
    };

    const ensurePlaybackFrame = (): void => {
      if (
        destroyed ||
        typeof window === "undefined" ||
        presentationImmediate() ||
        currentPlayback.value.animationComplete ||
        playbackFrame !== undefined
      ) {
        return;
      }

      playbackFrame = requestFrame(() => {
        playbackFrame = undefined;
        const previous = currentPlayback.value;
        const next = session.advance();
        if (
          next.visibleUnitCount !== previous.visibleUnitCount ||
          (next.animationComplete && !completionRendered)
        ) {
          completionRendered = next.animationComplete;
          currentPlayback.value = next;
        }
        ensurePlaybackFrame();
      });
    };

    const refreshPlayback = (input = currentInput.value): void => {
      if (!input) return;
      cancelPlaybackFrame();
      const units = playbackUnits(input);
      if (presentationImmediate()) {
        currentPlayback.value = session.immediate(input, units);
      } else if (mounted.value && resolvedMotion.value === "animate") {
        currentPlayback.value = session.schedule(input, units);
      } else {
        currentPlayback.value = emptyPlayback();
      }
      completionRendered = currentPlayback.value.animationComplete;
      ensurePlaybackFrame();
    };

    const publishResourceChange = (): void => {
      resourceNow.value = browserClock.now();
    };

    const ensureImages = (descriptors: ReadonlyArray<ImageDescriptor>): void => {
      if (
        typeof window === "undefined" ||
        presentationImmediate()
      ) {
        return;
      }

      for (const descriptor of descriptors) {
        if (
          imageLoaders.has(descriptor.id) ||
          imageReadiness.value.has(descriptor.id)
        ) {
          continue;
        }

        let finished = false;
        const finish = (
          status: ImageReadiness["status"],
          image?: HTMLImageElement,
        ): void => {
          if (finished || destroyed) return;
          finished = true;
          imageLoaders.delete(descriptor.id);

          const readyAt = browserClock.now();
          const width = image?.naturalWidth ?? 0;
          const height = image?.naturalHeight ?? 0;
          const next = new Map(imageReadiness.value);
          next.set(
            descriptor.id,
            status === "ready" && width > 0 && height > 0
              ? { height, readyAt, status, width }
              : { readyAt, status },
          );
          imageReadiness.value = next;
          publishResourceChange();

          const timer = window.setTimeout(() => {
            resourceTimers.delete(timer);
            publishResourceChange();
          }, props.duration + 20);
          resourceTimers.add(timer);
        };

        if (descriptor.src.length === 0) {
          finish("error");
          continue;
        }

        const image = new window.Image();
        imageLoaders.set(descriptor.id, image);
        image.decoding = "async";
        image.onerror = () => finish("error");
        let decodeStarted = false;
        const handleLoad = (): void => {
          if (decodeStarted || finished) return;
          decodeStarted = true;
          const decoded = typeof image.decode === "function"
            ? image.decode().catch(() => undefined)
            : Promise.resolve();
          void decoded.then(() => finish("ready", image));
        };
        image.onload = handleLoad;
        image.src = descriptor.src;
        if (image.complete && image.naturalWidth > 0) handleLoad();
      }
    };

    const commitCodeHighlight = (
      highlighter: CodeHighlighter,
      request: CodeBlockRequest,
      key: string,
      result: Parameters<typeof resolveCodeHighlight>[1],
    ): void => {
      if (
        destroyed ||
        props.codeHighlighter !== highlighter ||
        codeRequestsByBlock.get(request.blockStart) !== key
      ) {
        return;
      }

      const next = new Map(codeHighlights.value);
      next.set(
        request.blockStart,
        resolveCodeHighlight(
          request,
          result,
          codeHighlights.value.get(request.blockStart),
        ),
      );
      codeHighlights.value = next;
      refreshPlayback();
    };

    const ensureCodeHighlights = (
      requests: ReadonlyArray<CodeBlockRequest>,
    ): void => {
      const highlighter = props.codeHighlighter;
      if (!mounted.value || !highlighter) return;

      for (const request of requests) {
        const key = codeBlockRequestKey(request);
        const current = codeHighlights.value.get(request.blockStart);
        if (
          (current?.language === request.language &&
            current.code === request.code) ||
          codeRequestsByBlock.get(request.blockStart) === key
        ) {
          continue;
        }
        codeRequestsByBlock.set(request.blockStart, key);
        let privateSession = codeSessionsByBlock.get(request.blockStart);
        if (!privateSession) {
          privateSession = {};
          codeSessionsByBlock.set(request.blockStart, privateSession);
        }

        void Promise.resolve(highlighter.highlight({
          code: request.code,
          language: request.language,
          session: privateSession,
        })).then(
          (result) => commitCodeHighlight(highlighter, request, key, result),
          () => commitCodeHighlight(highlighter, request, key, undefined),
        );
      }
    };

    const flushInput = (): void => {
      const pending = pendingInput;
      pendingInput = undefined;
      if (!pending || destroyed) return;

      const input = session.prepareInput(
        pending.source,
        pending.receiving,
        props.reveal,
      );
      session.commitInput(input);
      currentInput.value = input;
      if (mounted.value) {
        ensureCodeHighlights(input.codeBlocks);
        ensureImages(input.images);
      }
      refreshPlayback(input);
    };

    const scheduleInputFlush = (): void => {
      if (!mounted.value || typeof window === "undefined") {
        flushInput();
        return;
      }
      if (inputFrame !== undefined) return;
      inputFrame = requestFrame(() => {
        inputFrame = undefined;
        flushInput();
      });
    };

    const clearResourceWork = (): void => {
      for (const image of imageLoaders.values()) {
        image.onload = null;
        image.onerror = null;
      }
      imageLoaders.clear();
      if (typeof window !== "undefined") {
        for (const timer of resourceTimers) window.clearTimeout(timer);
      }
      resourceTimers.clear();
    };

    const resetSession = (): void => {
      if (typeof window !== "undefined") {
        if (inputFrame !== undefined) cancelFrame(inputFrame);
        inputFrame = undefined;
        cancelPlaybackFrame();
      }
      clearResourceWork();
      codeRequestsByBlock.clear();
      codeSessionsByBlock.clear();
      codeHighlights.value = new Map();
      imageReadiness.value = new Map();
      resourceNow.value = 0;
      presentationCache = createWebPresentationCache();
      session = new StreamingSession(browserClock, {
        duration: props.duration,
        interval: props.interval,
      });
      requestedSource = props.markdown;
      pendingInput = {
        receiving: props.receiving,
        source: props.markdown,
      };
      announcedSource = undefined;
      completionAnnouncement.value = "";
      flushInput();
    };

    function handleMotionChange(event: MediaQueryListEvent): void {
      if (!event.matches || motionDisabled.value) return;
      motionDisabled.value = true;
      refreshPlayback();
    }

    const removeMediaListener = (): void => {
      if (!mediaQuery) return;
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", handleMotionChange);
      } else {
        mediaQuery.removeListener?.(handleMotionChange);
      }
      mediaQuery = undefined;
    };

    const configureMotion = (): void => {
      removeMediaListener();
      if (
        !mounted.value ||
        typeof window === "undefined" ||
        props.reducedMotion !== "system" ||
        typeof window.matchMedia !== "function"
      ) {
        return;
      }
      mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
      if (mediaQuery.matches) motionDisabled.value = true;
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleMotionChange);
      } else {
        mediaQuery.addListener?.(handleMotionChange);
      }
    };

    const synchronizeAnimationPhases = (): void => {
      const element = root.value;
      if (!element) return;
      const now = browserClock.now();
      const nextElements = new Set<HTMLElement>();
      for (const animated of element.querySelectorAll<HTMLElement>(PHASE_SELECTOR)) {
        nextElements.add(animated);
        const startAt = Number(animated.dataset.smoothstreamAnimationStart);
        const duration = Number(animated.dataset.smoothstreamAnimationDuration);
        if (!Number.isFinite(startAt) || !Number.isFinite(duration)) continue;

        const synchronized = synchronizedPhases.get(animated);
        if (
          synchronized?.startAt === startAt &&
          synchronized.duration === duration
        ) {
          animated.style.setProperty(PHASE_PROPERTY, synchronized.delay);
          continue;
        }
        const currentTime = Math.max(0, Math.min(duration, now - startAt));
        const delay = String(-currentTime) + "ms";
        animated.style.setProperty(PHASE_PROPERTY, delay);
        synchronizedPhases.set(animated, { delay, duration, startAt });
      }

      for (const previous of phasedElements) {
        if (!nextElements.has(previous)) {
          previous.style.removeProperty(PHASE_PROPERTY);
          if (previous.style.length === 0) previous.removeAttribute("style");
        }
      }
      phasedElements = nextElements;
    };

    const publishCompletionIfReady = (): void => {
      const input = currentInput.value;
      const presentation = lastPresentation;
      const element = root.value;
      if (
        props.mode !== "streaming" ||
        !mounted.value ||
        !input ||
        !presentation ||
        !element
      ) {
        return;
      }
      if (input.inputOpen) completionAnnouncement.value = "";
      if (
        input.inputOpen ||
        input.plan.tree.children.length === 0 ||
        !presentation.allPlannedUnitsCompacted ||
        element.querySelector("[data-smoothstream-unit]") !== null ||
        announcedSource === input.source
      ) {
        return;
      }
      announcedSource = input.source;
      completionAnnouncement.value = COMPLETION_ANNOUNCEMENT;
    };

    const afterRender = (): void => {
      synchronizeAnimationPhases();
      publishCompletionIfReady();
    };

    watch(
      () => [props.markdown, props.receiving] as const,
      ([source, receiving]) => {
        if (!source.startsWith(requestedSource)) {
          throw new Error(
            "Smoothstream Markdown must be append-only. Give a different response a new Vue key.",
          );
        }
        requestedSource = source;
        pendingInput = { receiving, source };
        if (receiving || announcedSource !== source) {
          announcedSource = undefined;
          completionAnnouncement.value = "";
        }
        scheduleInputFlush();
      },
      { flush: "sync" },
    );

    watch(
      () => [props.duration, props.interval, props.mode, props.reveal] as const,
      resetSession,
      { flush: "sync" },
    );

    watch(
      () => props.codeHighlighter,
      () => {
        codeRequestsByBlock.clear();
        codeSessionsByBlock.clear();
        codeHighlights.value = new Map();
        const input = currentInput.value;
        if (input) ensureCodeHighlights(input.codeBlocks);
        refreshPlayback(input);
      },
      { flush: "sync" },
    );

    watch(
      () => props.reducedMotion,
      () => {
        configureMotion();
        const input = currentInput.value;
        if (input && !presentationImmediate()) ensureImages(input.images);
        refreshPlayback(input);
      },
      { flush: "sync" },
    );

    flushInput();

    onMounted(() => {
      mounted.value = true;
      configureMotion();
      const input = currentInput.value;
      if (input) {
        ensureCodeHighlights(input.codeBlocks);
        ensureImages(input.images);
        refreshPlayback(input);
      }
      void nextTick(afterRender);
    });

    onUpdated(afterRender);

    onBeforeUnmount(() => {
      destroyed = true;
      removeMediaListener();
      if (typeof window !== "undefined") {
        if (inputFrame !== undefined) cancelFrame(inputFrame);
        cancelPlaybackFrame();
      }
      clearResourceWork();
      codeRequestsByBlock.clear();
      codeSessionsByBlock.clear();
    });

    const renderContent = (): VNode[] => {
      const input = currentInput.value;
      if (
        !input ||
        (props.mode === "streaming" && resolvedMotion.value === "pending")
      ) {
        lastPresentation = undefined;
        return [];
      }
      const playback = currentPlayback.value;
      const now = Math.max(playback.now, resourceNow.value);
      const presentation = session.present(input, playback, { now });
      lastPresentation = presentation;
      return webNodesToVue(createWebPresentation({
        cache: presentationCache,
        codeHighlighterEnabled: props.codeHighlighter !== undefined,
        codeHighlights: codeHighlights.value,
        compactedBlockIds: presentation.compactedBlockIds,
        compactedUnitIds: presentation.compactedUnitIds,
        images: imageReadiness.value,
        immediate: presentationImmediate(),
        now,
        reveal: input.reveal,
        schedules: presentation.schedules,
        showLanguageLabels: props.codeHighlighter?.showLanguageLabels !== false,
        tree: input.plan.tree,
        units: input.plan.units,
      }));
    };

    return () => {
      const motion = props.mode === "streaming" &&
          resolvedMotion.value === "pending"
        ? "pending"
        : resolvedMotion.value === "none"
          ? "none"
          : "animate";
      const rootNode = h(
        "div",
        mergeProps(attrs, {
          "data-smoothstream": true,
          "data-smoothstream-mode": props.mode,
          "data-smoothstream-motion": motion,
          "data-smoothstream-reduced-motion": props.reducedMotion,
          "data-smoothstream-reveal": props.reveal,
          "data-smoothstream-theme": props.unstyled ? undefined : "default",
          ref: root,
          style: {
            "--smoothstream-duration":
              String(resolvedMotion.value === "none" ? 0 : props.duration) +
              "ms",
            "--smoothstream-interval":
              String(resolvedMotion.value === "none" ? 0 : props.interval) +
              "ms",
          },
        }),
        renderContent(),
      );
      const announcer = props.mode === "streaming" && mounted.value
        ? h(Teleport, { to: "body" }, h("div", {
            "aria-atomic": true,
            "aria-live": "polite",
            "data-smoothstream-announcer": true,
            role: "status",
            style: screenReaderOnlyStyle,
          }, completionAnnouncement.value))
        : null;
      return h(Fragment, null, [rootNode, announcer]);
    };
  },
});
