// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  reactive,
  type App,
} from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodeHighlighter,
  CodeHighlightResult,
} from "@smoothstream/core";
import { Smoothstream } from "@smoothstream/vue";
import { installContractClock } from "../contracts/test-clock";

interface MountedVue {
  readonly app: App;
  readonly container: HTMLDivElement;
  readonly element: HTMLDivElement;
}

const mountSmoothstream = (
  props: Record<string, unknown>,
): MountedVue => {
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(defineComponent({
    setup: () => () => h(Smoothstream, props),
  }));
  app.mount(container);
  const element = container.querySelector<HTMLDivElement>(
    "[data-smoothstream]",
  );
  if (!element) throw new Error("Vue adapter did not render its root.");
  return { app, container, element };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Smoothstream Vue", () => {
  it("uses the markdown prop and forwards Vue attributes to its root", () => {
    const view = mountSmoothstream({
      "aria-label": "Assistant response",
      class: ["message", { complete: true }],
      id: "answer",
      markdown: "A **completed** response.",
      mode: "static",
    });

    expect(view.element).toHaveAttribute("id", "answer");
    expect(view.element).toHaveAccessibleName("Assistant response");
    expect(view.element).toHaveClass("message", "complete");
    expect(view.element).toHaveAttribute("data-smoothstream-mode", "static");
    expect(view.element.querySelector("strong")).toHaveTextContent("completed");

    view.app.unmount();
  });

  it("coalesces reactive append-only Markdown props through Vue updates", async () => {
    const clock = installContractClock();
    const state = reactive({ markdown: "A", receiving: true });
    const container = document.createElement("div");
    document.body.append(container);
    const app = createApp(defineComponent({
      setup: () => () => h(Smoothstream, {
        markdown: state.markdown,
        receiving: state.receiving,
        reducedMotion: "always",
      }),
    }));
    app.mount(container);

    state.markdown = "A response";
    state.markdown = "A response arrives.";
    state.receiving = false;
    await nextTick();
    await clock.drain(async () => {
      await vi.runAllTimersAsync();
      await nextTick();
    });

    expect(container.querySelector("[data-smoothstream]")).toHaveTextContent(
      "A response arrives.",
    );
    expect(document.querySelector("[data-smoothstream-announcer]"))
      .toHaveTextContent("Content ready.");

    app.unmount();
  });

  it("keeps the code shell mounted while highlighting resolves and copies before it does", async () => {
    let resolveHighlight: ((result: CodeHighlightResult) => void) | undefined;
    const highlight = vi.fn(() => new Promise<CodeHighlightResult>((resolve) => {
      resolveHighlight = resolve;
    }));
    const highlighter: CodeHighlighter = {
      highlight,
      name: "vue-test-highlighter",
    };
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const view = mountSmoothstream({
      codeHighlighter: highlighter,
      markdown: "```ts\nconst ready = true;\n```",
      mode: "static",
      reducedMotion: "never",
    });
    await nextTick();

    expect(highlight).toHaveBeenCalledOnce();
    const pre = view.element.querySelector<HTMLPreElement>(
      "pre[data-smoothstream-code-block]",
    );
    const toolbar = pre?.querySelector("[data-smoothstream-code-toolbar]");
    const button = pre?.querySelector<HTMLButtonElement>(
      "button[data-smoothstream-code-copy]",
    );
    expect(pre).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(button).toBeEnabled();

    button?.click();
    await vi.waitFor(async () => {
      await nextTick();
      expect(writeText).toHaveBeenCalledWith("const ready = true;");
      expect(button).toHaveAccessibleName("Code copied");
    });

    resolveHighlight?.({
      languageLabel: "TypeScript",
      lines: [{
        tokens: [
          { content: "const", style: { color: "#c00000" } },
          { content: " ready = true;" },
        ],
      }],
    });
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(view.element.querySelector("pre[data-smoothstream-code-block]"))
      .toBe(pre);
    expect(pre?.querySelector("[data-smoothstream-code-toolbar]"))
      .toBe(toolbar);
    expect(pre?.querySelector("[data-smoothstream-code-copy]"))
      .toBe(button);
    expect(pre?.querySelector("[data-smoothstream-code-language]"))
      .toHaveTextContent("TypeScript");
    expect(pre?.querySelector("[data-smoothstream-code-token]"))
      .toHaveStyle({ color: "rgb(192, 0, 0)" });

    view.app.unmount();
  });

  it("removes media listeners, frames, and pending image handlers on unmount", async () => {
    vi.useFakeTimers();
    const removeEventListener = vi.fn();
    const addEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      addEventListener,
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      removeEventListener,
      removeListener: vi.fn(),
    })));
    const cancelAnimationFrame = vi.fn((id: number) => window.clearTimeout(id));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    class PendingImage {
      static readonly instances: PendingImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";

      constructor() {
        PendingImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", PendingImage);

    const view = mountSmoothstream({
      markdown: "![Diagram](/diagram.svg)\n\nContent continues.",
      receiving: true,
    });
    await nextTick();
    expect(PendingImage.instances).toHaveLength(1);
    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    const image = PendingImage.instances[0];
    view.app.unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(image?.onload).toBeNull();
    expect(image?.onerror).toBeNull();
  });
});
