// @vitest-environment jsdom

import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("resolves a reduced system preference after hydrating an identical shell", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = "Server-provided **Markdown**.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream motion="system">{source}</Smoothstream>,
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
        <Smoothstream motion="system">{source}</Smoothstream>,
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
      <Smoothstream motion="system">{source}</Smoothstream>,
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
        <Smoothstream motion="system">{source}</Smoothstream>,
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
      <Smoothstream receiving motion="system">{""}</Smoothstream>,
    );
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream receiving motion="system">{""}</Smoothstream>,
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
          motion="system"
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
      <Smoothstream motion="none">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="none"');
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
        <Smoothstream motion="none">{source}</Smoothstream>,
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
      <Smoothstream motion="animate">{source}</Smoothstream>,
    );

    expect(serverHtml).toContain('data-smoothstream-motion="animate"');
    expect(serverHtml).not.toContain("Animate despite");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    await act(async () => {
      root = hydrateRoot(
        container,
        <Smoothstream motion="animate">{source}</Smoothstream>,
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

  it("mounts a pending image only after system motion resolves", async () => {
    vi.stubGlobal("matchMedia", matchMedia(true));
    const source = "![Diagram](/diagram.svg)\n\nLater safe content.";
    const serverHtml = renderWithoutWindow(
      <Smoothstream motion="system">{source}</Smoothstream>,
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
        <Smoothstream motion="system">{source}</Smoothstream>,
        {
          onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
      await Promise.resolve();
    });

    expect(recoverableErrors.map(String)).toEqual([]);
    expect(container.querySelector("img")).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(container.querySelector("img")).toHaveAttribute("aria-hidden", "true");
    expect(container).toHaveTextContent("Later safe content.");

    await act(async () => root?.unmount());
  });
});
