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
} from "@smoothstream/core";
import { renderDom } from "./render";
import type {
  SmoothstreamController,
  SmoothstreamMode,
  SmoothstreamOptions,
  SmoothstreamReducedMotion,
  SmoothstreamUpdateOptions,
} from "./types";

const COMPLETION_ANNOUNCEMENT = "Content ready.";

interface PendingInput {
  readonly receiving: boolean;
  readonly source: string;
}

const screenReaderOnlyCss = [
  "border:0",
  "clip:rect(0 0 0 0)",
  "clip-path:inset(50%)",
  "height:1px",
  "margin:-1px",
  "overflow:hidden",
  "padding:0",
  "position:absolute",
  "white-space:nowrap",
  "width:1px",
].join(";");

class DomStreamingController implements SmoothstreamController {
  readonly element: HTMLDivElement;

  readonly #announcer: HTMLDivElement | null;
  readonly #clock: Clock;
  readonly #codeHighlighter: CodeHighlighter | undefined;
  readonly #codeHighlights = new Map<number, ResolvedCodeHighlight>();
  readonly #codeRequestsByBlock = new Map<number, string>();
  readonly #codeSessionsByBlock = new Map<number, object>();
  readonly #document: Document;
  readonly #duration: number;
  readonly #imageLoaders = new Map<string, HTMLImageElement>();
  readonly #imageReadiness = new Map<string, ImageReadiness>();
  readonly #interval: number;
  readonly #mode: SmoothstreamMode;
  readonly #reducedMotion: SmoothstreamReducedMotion;
  readonly #reveal: "character" | "word";
  readonly #session: StreamingSession;
  readonly #timeouts = new Set<number>();
  readonly #view: Window;

  #announcedSource: string | null = null;
  #completionRendered = false;
  #currentInput: StreamingInputSnapshot | null = null;
  #currentPlayback: StreamingPlaybackSnapshot | null = null;
  #destroyed = false;
  #inputFrame: number | null = null;
  #mediaQuery: MediaQueryList | null = null;
  #motionDisabled: boolean;
  #pendingInput: PendingInput | null = null;
  #playbackFrame: number | null = null;
  #requestedReceiving: boolean;
  #requestedSource = "";

  constructor(container: Element, options: SmoothstreamOptions) {
    this.#document = container.ownerDocument;
    const view = this.#document.defaultView;
    if (!view) {
      throw new Error("Smoothstream DOM requires a document with a browser window.");
    }
    this.#view = view;
    this.#codeHighlighter = options.codeHighlighter;
    this.#duration = options.duration ?? 1_000;
    this.#interval = options.interval ?? 3;
    this.#mode = options.mode ?? "streaming";
    this.#reducedMotion = options.reducedMotion ?? "system";
    this.#reveal = options.reveal ?? "character";
    this.#requestedReceiving = options.receiving ?? false;
    this.#clock = {
      now: () => this.#view.performance?.now() ?? Date.now(),
    };
    this.#session = new StreamingSession(this.#clock, {
      duration: this.#duration,
      interval: this.#interval,
    });

    this.element = this.#document.createElement("div");
    if (options.className) this.element.className = options.className;
    this.element.setAttribute("data-smoothstream", "true");
    this.element.setAttribute("data-smoothstream-mode", this.#mode);
    if (!options.unstyled) {
      this.element.setAttribute("data-smoothstream-theme", "default");
    }
    this.element.setAttribute(
      "data-smoothstream-reduced-motion",
      this.#reducedMotion,
    );
    this.element.setAttribute("data-smoothstream-reveal", this.#reveal);
    this.element.style.setProperty("--smoothstream-duration", `${this.#duration}ms`);
    this.element.style.setProperty("--smoothstream-interval", `${this.#interval}ms`);
    this.element.addEventListener("click", this.#handleRootClick);
    container.append(this.element);

    this.#announcer = this.#mode === "streaming"
      ? this.#document.createElement("div")
      : null;
    if (this.#announcer) {
      this.#announcer.setAttribute("aria-atomic", "true");
      this.#announcer.setAttribute("aria-live", "polite");
      this.#announcer.setAttribute("data-smoothstream-announcer", "true");
      this.#announcer.setAttribute("role", "status");
      this.#announcer.style.cssText = screenReaderOnlyCss;
      (this.#document.body ?? this.#document.documentElement).append(
        this.#announcer,
      );
    }

    this.#mediaQuery = this.#reducedMotion === "system" && this.#view.matchMedia
      ? this.#view.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    this.#motionDisabled =
      this.#reducedMotion === "always" || this.#mediaQuery?.matches === true;
    this.#syncMotionAttributes();
    this.#mediaQuery?.addEventListener("change", this.#handleMotionChange);

    this.update("", {
      receiving: this.#requestedReceiving,
    });
  }

  update(
    markdown: string,
    options: SmoothstreamUpdateOptions = {},
  ): void {
    if (this.#destroyed) {
      throw new Error("Cannot update a destroyed Smoothstream DOM controller.");
    }
    if (!markdown.startsWith(this.#requestedSource)) {
      throw new Error(
        "Smoothstream Markdown must be append-only. Create a new controller to render a different response.",
      );
    }
    this.#requestedSource = markdown;
    this.#requestedReceiving = options.receiving ?? this.#requestedReceiving;
    this.#pendingInput = {
      receiving: this.#requestedReceiving,
      source: markdown,
    };
    if (this.#requestedReceiving || this.#announcedSource !== markdown) {
      this.#announcedSource = null;
      if (this.#announcer) this.#announcer.textContent = "";
    }
    if (this.#inputFrame === null) {
      this.#inputFrame = this.#requestFrame(() => {
        this.#inputFrame = null;
        this.#flushInput();
      });
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#inputFrame !== null) this.#cancelFrame(this.#inputFrame);
    if (this.#playbackFrame !== null) this.#cancelFrame(this.#playbackFrame);
    this.element.removeEventListener("click", this.#handleRootClick);
    this.#mediaQuery?.removeEventListener("change", this.#handleMotionChange);
    for (const timeout of this.#timeouts) this.#view.clearTimeout(timeout);
    for (const image of this.#imageLoaders.values()) {
      image.onload = null;
      image.onerror = null;
    }
    this.#timeouts.clear();
    this.#codeHighlights.clear();
    this.#codeRequestsByBlock.clear();
    this.#codeSessionsByBlock.clear();
    this.#imageLoaders.clear();
    this.#announcer?.remove();
    this.element.remove();
  }

  readonly #handleMotionChange = (event: MediaQueryListEvent): void => {
    // Once reduced motion is observed, keep it for this mounted response.
    // Turning animation back on mid-playback would replay content that is
    // already visible.
    if (!event.matches || this.#motionDisabled) {
      return;
    }
    this.#motionDisabled = true;
    this.#syncMotionAttributes();
    if (this.#currentInput) {
      const units = this.#playbackUnits(this.#currentInput);
      this.#currentPlayback = this.#session.immediate(this.#currentInput, units);
      this.#renderCurrent();
      this.#ensurePlaybackFrame();
    }
  };

  #syncMotionAttributes(): void {
    this.element.setAttribute(
      "data-smoothstream-motion",
      this.#motionDisabled ? "none" : "animate",
    );
    this.element.style.setProperty(
      "--smoothstream-duration",
      `${this.#motionDisabled ? 0 : this.#duration}ms`,
    );
    this.element.style.setProperty(
      "--smoothstream-interval",
      `${this.#motionDisabled ? 0 : this.#interval}ms`,
    );
  }

  #presentationImmediate(): boolean {
    return this.#motionDisabled || this.#mode === "static";
  }

  #flushInput(): void {
    const pending = this.#pendingInput;
    this.#pendingInput = null;
    if (!pending || this.#destroyed) return;

    const input = this.#session.prepareInput(
      pending.source,
      pending.receiving,
      this.#reveal,
    );
    this.#session.commitInput(input);
    this.#currentInput = input;
    this.#ensureImages(input.images);
    this.#ensureCodeHighlights(input.codeBlocks);
    const units = this.#playbackUnits(input);
    this.#currentPlayback = this.#presentationImmediate()
      ? this.#session.immediate(input, units)
      : this.#session.schedule(input, units);
    this.#completionRendered = this.#currentPlayback.animationComplete;
    this.#renderCurrent();
    this.#ensurePlaybackFrame();
  }

  #ensurePlaybackFrame(): void {
    if (
      this.#destroyed ||
      this.#presentationImmediate() ||
      this.#currentPlayback?.animationComplete !== false ||
      this.#playbackFrame !== null
    ) {
      return;
    }
    this.#playbackFrame = this.#requestFrame(() => {
      this.#playbackFrame = null;
      const previous = this.#currentPlayback;
      if (!previous || this.#destroyed) return;
      const next = this.#session.advance();
      this.#currentPlayback = next;
      if (
        next.visibleUnitCount !== previous.visibleUnitCount ||
        (next.animationComplete && !this.#completionRendered)
      ) {
        this.#completionRendered = next.animationComplete;
        this.#renderCurrent();
      }
      this.#ensurePlaybackFrame();
    });
  }

  #renderCurrent(): void {
    const input = this.#currentInput;
    const playback = this.#currentPlayback;
    if (!input || !playback || this.#destroyed) return;
    const now = this.#clock.now();
    const currentPlayback = this.#presentationImmediate()
      ? playback
      : this.#session.advance(now);
    this.#currentPlayback = currentPlayback;
    const presentation = this.#session.present(input, currentPlayback, {
      now,
    });
    renderDom(this.element, {
      codeHighlights: this.#codeHighlights,
      compactedBlockIds: presentation.compactedBlockIds,
      compactedUnitIds: presentation.compactedUnitIds,
      images: this.#imageReadiness,
      now,
      reveal: input.reveal,
      schedules: presentation.schedules,
      tree: input.plan.tree,
      units: input.plan.units,
    });

    if (
      !input.inputOpen &&
      input.plan.tree.children.length > 0 &&
      presentation.allPlannedUnitsCompacted &&
      this.element.querySelector("[data-smoothstream-unit]") === null &&
      this.#announcedSource !== input.source
    ) {
      this.#announcedSource = input.source;
      if (this.#announcer) {
        this.#announcer.textContent = COMPLETION_ANNOUNCEMENT;
      }
    }
  }

  #playbackUnits(input: StreamingInputSnapshot) {
    return unitsReadyForCodeHighlights(
      input.plan.units,
      this.#codeHighlighter,
      this.#codeHighlights,
    );
  }

  #ensureCodeHighlights(requests: ReadonlyArray<CodeBlockRequest>): void {
    const highlighter = this.#codeHighlighter;
    if (!highlighter) return;

    for (const request of requests) {
      const key = codeBlockRequestKey(request);
      const current = this.#codeHighlights.get(request.blockStart);
      if (
        (current?.language === request.language && current.code === request.code) ||
        this.#codeRequestsByBlock.get(request.blockStart) === key
      ) {
        continue;
      }

      this.#codeRequestsByBlock.set(request.blockStart, key);
      let session = this.#codeSessionsByBlock.get(request.blockStart);
      if (!session) {
        session = {};
        this.#codeSessionsByBlock.set(request.blockStart, session);
      }

      void Promise.resolve(highlighter.highlight({
        code: request.code,
        language: request.language,
        session,
      })).then(
        (result) => this.#commitCodeHighlight(request, key, result),
        () => this.#commitCodeHighlight(request, key, undefined),
      );
    }
  }

  #commitCodeHighlight(
    request: CodeBlockRequest,
    key: string,
    result: Parameters<typeof resolveCodeHighlight>[1],
  ): void {
    if (
      this.#destroyed ||
      this.#codeRequestsByBlock.get(request.blockStart) !== key
    ) {
      return;
    }
    this.#codeHighlights.set(
      request.blockStart,
      resolveCodeHighlight(
        request,
        result,
        this.#codeHighlights.get(request.blockStart),
      ),
    );

    const input = this.#currentInput;
    if (!input) return;
    const units = this.#playbackUnits(input);
    this.#currentPlayback = this.#presentationImmediate()
      ? this.#session.immediate(input, units)
      : this.#session.schedule(input, units);
    this.#completionRendered = this.#currentPlayback.animationComplete;
    this.#renderCurrent();
    this.#ensurePlaybackFrame();
  }

  #ensureImages(images: ReadonlyArray<ImageDescriptor>): void {
    for (const descriptor of images) {
      if (
        this.#imageLoaders.has(descriptor.id) ||
        this.#imageReadiness.has(descriptor.id)
      ) {
        continue;
      }

      let finished = false;
      const finish = (
        status: ImageReadiness["status"],
        image?: HTMLImageElement,
      ): void => {
        if (finished || this.#destroyed) {
          return;
        }
        finished = true;
        this.#imageLoaders.delete(descriptor.id);

        const readyAt = this.#clock.now();
        const width = image?.naturalWidth ?? 0;
        const height = image?.naturalHeight ?? 0;
        this.#imageReadiness.set(
          descriptor.id,
          status === "ready" && width > 0 && height > 0
            ? { height, readyAt, status, width }
            : { readyAt, status },
        );
        this.#resourceChanged();
      };

      if (descriptor.src.length === 0) {
        finish("error");
        continue;
      }

      const ImageConstructor = (
        this.#view as Window & { Image: new () => HTMLImageElement }
      ).Image;
      const image = new ImageConstructor();
      this.#imageLoaders.set(descriptor.id, image);
      image.decoding = "async";
      image.onerror = () => finish("error");
      let decodeStarted = false;
      const handleLoad = (): void => {
        if (decodeStarted || finished) {
          return;
        }
        decodeStarted = true;
        const decoded = typeof image.decode === "function"
          ? image.decode().catch(() => undefined)
          : Promise.resolve();
        void decoded.then(() => finish("ready", image));
      };
      image.onload = handleLoad;
      image.src = descriptor.src;

      if (image.complete && image.naturalWidth > 0) {
        handleLoad();
      }
    }
  }

  #resourceChanged(): void {
    if (this.#destroyed) return;
    this.#renderCurrent();
    const timeout = this.#view.setTimeout(() => {
      this.#timeouts.delete(timeout);
      this.#renderCurrent();
    }, this.#duration + 20);
    this.#timeouts.add(timeout);
  }

  readonly #handleRootClick = (event: Event): void => {
    const target = event.target;
    if (
      !target ||
      !("closest" in target) ||
      typeof target.closest !== "function"
    ) {
      return;
    }
    const button = (target as Element).closest<HTMLButtonElement>(
      "button[data-smoothstream-code-copy]",
    );
    if (!button || !this.element.contains(button) || button.disabled) return;
    void this.#copyCodeBlock(button);
  };

  async #copyCodeBlock(button: HTMLButtonElement): Promise<void> {
    const pre = button.closest("pre[data-smoothstream-code-block]");
    const code = pre?.querySelector("code")?.textContent;
    if (!pre || code === null || code === undefined) return;

    try {
      if (this.#view.navigator.clipboard?.writeText) {
        await this.#view.navigator.clipboard.writeText(code);
      } else {
        const textarea = this.#document.createElement("textarea");
        textarea.value = code;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        this.#document.body.append(textarea);
        textarea.select();
        const copied = this.#document.execCommand?.("copy") === true;
        textarea.remove();
        if (!copied) throw new Error("Clipboard copy is unavailable");
      }

      const icon = button.querySelector<HTMLElement>(
        "[data-smoothstream-code-icon-swap]",
      );
      icon?.setAttribute("data-state", "check");
      button.setAttribute("aria-label", "Code copied");
      const timeout = this.#view.setTimeout(() => {
        this.#timeouts.delete(timeout);
        if (!button.isConnected) return;
        icon?.setAttribute("data-state", "copy");
        const label = pre.getAttribute("data-smoothstream-code-label") ?? "code";
        button.setAttribute("aria-label", `Copy ${label} code`);
      }, 2_000);
      this.#timeouts.add(timeout);
    } catch {
      button.setAttribute("aria-label", "Copy failed");
    }
  }

  #requestFrame(callback: FrameRequestCallback): number {
    return this.#view.requestAnimationFrame
      ? this.#view.requestAnimationFrame(callback)
      : this.#view.setTimeout(() => callback(this.#clock.now()), 16);
  }

  #cancelFrame(frame: number): void {
    if (this.#view.cancelAnimationFrame) {
      this.#view.cancelAnimationFrame(frame);
    } else {
      this.#view.clearTimeout(frame);
    }
  }
}

export const createSmoothstream = (
  container: Element,
  options: SmoothstreamOptions = {},
): SmoothstreamController => new DomStreamingController(container, options);
