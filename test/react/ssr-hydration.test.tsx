// @vitest-environment jsdom

import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CodeHighlighter,
  CodeHighlightResult,
} from "@smoothstream/core";
import { Smoothstream } from "../../packages/react/src/Smoothstream";

const renderWithoutWindow = (element: ReactElement): string => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: undefined,
  });

  try {
    return renderToString(element);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
};

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

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Smoothstream SSR hydration", () => {
  it("server-renders static Markdown before resolving system motion", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = "Previously **completed** Markdown.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream mode="static" reducedMotion="system">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-mode="static"');
    expect(serverHtml).toContain('data-smoothstream-motion="animate"');
    expect(serverHtml).toContain('data-smoothstream-reduced-motion="system"');
    expect(serverHtml).toContain("Previously ");
    expect(serverHtml).toContain("<strong>completed</strong>");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream mode="static" reducedMotion="system">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(container.querySelector("strong")).toHaveTextContent("completed");
    expect(document.body.querySelector("[data-smoothstream-announcer]"))
      .toBeNull();

    await act(async () => root?.unmount());
  });

  it("server-renders complete static resources before client enhancement", async () => {
    let resolveHighlight: ((result: CodeHighlightResult) => void) | undefined;
    const highlight = vi.fn(
      () => new Promise<CodeHighlightResult>((resolve) => {
        resolveHighlight = resolve;
      }),
    );
    const highlighter: CodeHighlighter = {
      highlight,
      name: "pending-ssr-highlighter",
    };
    const source = [
      "Before the code.",
      "",
      "```ts",
      "const ready = true;",
      "```",
      "",
      "![Diagram](/diagram.svg)",
      "",
      "After the resources.",
    ].join("\n");
    const element = (
      <Smoothstream
        codeHighlighter={highlighter}
        mode="static"
        reducedMotion="never"
      >
        {source}
      </Smoothstream>
    );
    const serverHtml = renderWithoutWindow(element);

    expect(highlight).not.toHaveBeenCalled();
    expect(serverHtml).toContain("Before the code.");
    expect(serverHtml).toContain("const ready = true;");
    expect(serverHtml).toContain("After the resources.");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const serverImage = container.querySelector("img");
    expect(serverImage).toHaveAttribute("src", "/diagram.svg");
    expect(serverImage).toHaveAttribute("alt", "Diagram");
    expect(serverImage).not.toHaveAttribute("aria-hidden");
    expect(serverImage).not.toHaveAttribute("data-smoothstream-image");
    expect(container.querySelector("pre code")?.textContent).toBe(
      "const ready = true;\n",
    );
    expect(container.querySelector("[data-smoothstream-code-token]"))
      .toBeNull();
    const serverPre = container.querySelector(
      "pre[data-smoothstream-code-block]",
    );
    const serverToolbar = serverPre?.querySelector(
      "[data-smoothstream-code-toolbar]",
    );
    const serverLanguage = serverPre?.querySelector(
      "[data-smoothstream-code-language]",
    );
    const serverCopyButton = serverPre?.querySelector<HTMLButtonElement>(
      "button[data-smoothstream-code-copy]",
    );
    expect(serverPre).not.toBeNull();
    expect(serverToolbar?.parentElement).toBe(serverPre);
    expect(serverLanguage).toBeEmptyDOMElement();
    expect(serverCopyButton).toBeEnabled();
    expect(serverCopyButton).toHaveAccessibleName("Copy code");

    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(highlight).toHaveBeenCalledOnce();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "const ready = true;\n",
    );
    expect(container.querySelector("pre[data-smoothstream-code-block]"))
      .toBe(serverPre);
    expect(container.querySelector("[data-smoothstream-code-toolbar]"))
      .toBe(serverToolbar);
    expect(container.querySelector("[data-smoothstream-code-copy]"))
      .toBe(serverCopyButton);
    expect(container).toHaveTextContent("After the resources.");
    expect(container.querySelector("img")).not.toHaveAttribute("aria-hidden");

    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await act(async () => {
      serverCopyButton?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("const ready = true;");

    await act(async () => {
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
    });

    expect(container.querySelector("[data-smoothstream-code-token]"))
      .toHaveStyle({ color: "rgb(0, 0, 255)" });
    expect(container.querySelector("pre[data-smoothstream-code-block]"))
      .toBe(serverPre);
    expect(container.querySelector("[data-smoothstream-code-toolbar]"))
      .toBe(serverToolbar);
    expect(container.querySelector("[data-smoothstream-code-copy]"))
      .toBe(serverCopyButton);
    expect(serverLanguage).toHaveTextContent("TypeScript");
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const ready = true;",
    );
    expect(container).toHaveTextContent("After the resources.");
    expect(container.querySelector("img")).not.toHaveAttribute("aria-hidden");

    await act(async () => root?.unmount());
  });

  it("resolves a reduced system preference after hydrating an identical shell", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = "Server-provided **Markdown**.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream reducedMotion="system">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="pending"');
    expect(serverHtml).not.toContain("Server-provided");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream reducedMotion="system">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(container.querySelector("p")).toHaveTextContent(
      "Server-provided Markdown.",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);

    await act(async () => root?.unmount());
  });

  it("starts animated playback only after hydrating an identical system shell", async () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const source = "Animate this response.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream reducedMotion="system">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="pending"');
    expect(serverHtml).not.toContain("Animate this response");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream reducedMotion="system">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    await act(async () => root?.unmount());
  });

  it("resolves system motion while an empty stream is waiting for its first token", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", matchMedia(false));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) =>
      window.clearTimeout(frameId),
    );
    const serverHtml = renderWithoutWindow(
      <Smoothstream receiving reducedMotion="system">{""}</Smoothstream>,
    );
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream receiving reducedMotion="system">{""}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );

    await act(async () => {
      root?.render(
        <Smoothstream
          receiving
          reducedMotion="system"
        >
          {"First token arrives.\n\n"}
        </Smoothstream>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(48);
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    await act(async () => root?.unmount());
  });

  it("server-renders disabled motion deterministically", async () => {
    vi.stubGlobal("matchMedia", matchMedia(false));
    const source = "Immediately **semantic**.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream reducedMotion="always">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="none"');
    expect(serverHtml).toContain('data-smoothstream-reduced-motion="always"');
    expect(serverHtml).toContain("Immediately ");
    expect(serverHtml).toContain("<strong>semantic</strong>");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream reducedMotion="always">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("strong")).toHaveTextContent("semantic");
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);

    await act(async () => root?.unmount());
  });

  it("server-renders forced animation as a deterministic playback shell", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const source = "Animate despite the preference.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream reducedMotion="never">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="animate"');
    expect(serverHtml).toContain('data-smoothstream-reduced-motion="never"');
    expect(serverHtml).not.toContain("Animate despite");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream reducedMotion="never">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    await act(async () => root?.unmount());
  });

  it("renders resources immediately after resolving reduced system motion", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = "![Diagram](/diagram.svg)\n\nLater safe content.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream reducedMotion="system">{source}</Smoothstream>,
    );

    expect(serverHtml).not.toContain("<img");
    expect(serverHtml).not.toContain("Later safe content");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream reducedMotion="system">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/diagram.svg",
    );
    expect(container.querySelector("img")).not.toHaveAttribute(
      "data-smoothstream-image",
    );
    expect(container.querySelector("img")).not.toHaveAttribute("aria-hidden");
    expect(container).toHaveTextContent("Later safe content.");

    await act(async () => root?.unmount());
  });
});
