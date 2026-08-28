// @vitest-environment jsdom

import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  type App,
} from "vue";
import { renderToString } from "@vue/server-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodeHighlighter,
  CodeHighlightResult,
} from "@smoothstream/core";
import { Smoothstream } from "@smoothstream/vue";

const matchMedia = (matches: boolean): typeof window.matchMedia => () => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
  matches,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
});

const renderWithoutWindow = async (app: App): Promise<string> => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined,
  });
  try {
    return await renderToString(app);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
};

const host = (props: Record<string, unknown>) => defineComponent({
  name: "SmoothstreamSsrHost",
  setup: () => () => h(Smoothstream, props),
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Smoothstream Vue SSR hydration", () => {
  it("server-renders static Markdown and hydrates the identical semantic tree", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = [
      "A **completed** response.",
      "",
      "![Diagram](/diagram.svg)",
    ].join("\n");
    const component = host({
      markdown: source,
      mode: "static",
      reducedMotion: "system",
    });
    const serverHtml = await renderWithoutWindow(createSSRApp(component));

    expect(serverHtml).toContain('data-smoothstream-mode="static"');
    expect(serverHtml).toContain('data-smoothstream-motion="animate"');
    expect(serverHtml).toContain("<strong>completed</strong>");
    expect(serverHtml).toContain('src="/diagram.svg"');
    expect(serverHtml).not.toContain("data-smoothstream-image=");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const serverRoot = container.querySelector("[data-smoothstream]");
    const serverStrong = container.querySelector("strong");
    const serverImage = container.querySelector("img");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = createSSRApp(component);
    app.mount(container);
    await nextTick();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(container.querySelector("[data-smoothstream]")).toBe(serverRoot);
    expect(container.querySelector("strong")).toBe(serverStrong);
    expect(container.querySelector("img")).toBe(serverImage);
    expect(serverRoot).toHaveAttribute("data-smoothstream-motion", "none");

    app.unmount();
  });

  it("does not run a code highlighter on the server and enhances in place after hydration", async () => {
    let resolveHighlight: ((result: CodeHighlightResult) => void) | undefined;
    const highlight = vi.fn(() => new Promise<CodeHighlightResult>((resolve) => {
      resolveHighlight = resolve;
    }));
    const highlighter: CodeHighlighter = {
      highlight,
      name: "vue-ssr-highlighter",
    };
    const component = host({
      codeHighlighter: highlighter,
      markdown: "```ts\nconst ready = true;\n```",
      mode: "static",
      reducedMotion: "never",
    });
    const serverHtml = await renderWithoutWindow(createSSRApp(component));

    expect(highlight).not.toHaveBeenCalled();
    expect(serverHtml).toContain("const ready = true;");
    expect(serverHtml).toContain("data-smoothstream-code-toolbar");
    expect(serverHtml).toContain("data-smoothstream-code-copy");
    expect(serverHtml).not.toContain("data-smoothstream-code-token");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const pre = container.querySelector("pre[data-smoothstream-code-block]");
    const toolbar = container.querySelector("[data-smoothstream-code-toolbar]");
    const copy = container.querySelector("[data-smoothstream-code-copy]");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = createSSRApp(component);
    app.mount(container);
    await nextTick();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(highlight).toHaveBeenCalledOnce();
    expect(container.querySelector("pre[data-smoothstream-code-block]"))
      .toBe(pre);
    expect(container.querySelector("[data-smoothstream-code-toolbar]"))
      .toBe(toolbar);
    expect(container.querySelector("[data-smoothstream-code-copy]"))
      .toBe(copy);

    resolveHighlight?.({
      languageLabel: "TypeScript",
      lines: [{
        tokens: [
          { content: "const", style: { color: "#0000ff" } },
          { content: " ready = true;" },
        ],
      }],
    });
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(container.querySelector("pre[data-smoothstream-code-block]"))
      .toBe(pre);
    expect(container.querySelector("[data-smoothstream-code-toolbar]"))
      .toBe(toolbar);
    expect(container.querySelector("[data-smoothstream-code-copy]"))
      .toBe(copy);
    expect(container.querySelector("[data-smoothstream-code-language]"))
      .toHaveTextContent("TypeScript");
    expect(container.querySelector("[data-smoothstream-code-token]"))
      .toHaveStyle({ color: "rgb(0, 0, 255)" });

    app.unmount();
  });

  it("server-renders an identical pending shell for system-motion streaming", async () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    const component = host({
      markdown: "Streaming content begins here.",
      receiving: true,
      reducedMotion: "system",
    });
    const serverHtml = await renderWithoutWindow(createSSRApp(component));

    expect(serverHtml).toContain('data-smoothstream-motion="pending"');
    expect(serverHtml).not.toContain("Streaming content begins here.");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const app = createSSRApp(component);
    app.mount(container);
    await nextTick();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );

    app.unmount();
  });
});
