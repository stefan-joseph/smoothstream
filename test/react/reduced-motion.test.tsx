// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Smoothstream } from "../../packages/react/src/Smoothstream";

const reducedMotionQuery = (
  initialMatches: boolean,
): {
  dispatch: (matches: boolean) => void;
  matchMedia: typeof window.matchMedia;
} => {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = "(prefers-reduced-motion: reduce)";
  const query = {
    addEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) => {
      if (typeof listener === "function") {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    addListener: (
      listener: ((event: MediaQueryListEvent) => void) | null,
    ) => {
      if (listener) {
        listeners.add(listener);
      }
    },
    dispatchEvent: () => true,
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    removeEventListener: (
      _type: string,
      listener: EventListenerOrEventListenerObject | null,
    ) => {
      if (typeof listener === "function") {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeListener: (
      listener: ((event: MediaQueryListEvent) => void) | null,
    ) => {
      if (listener) {
        listeners.delete(listener);
      }
    },
  } as unknown as MediaQueryList;

  return {
    dispatch: (nextMatches) => {
      matches = nextMatches;
      const event = { matches, media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
    matchMedia: () => query,
  };
};

describe("Smoothstream reduced motion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) =>
      window.clearTimeout(frameId),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { animate?: Element["animate"] }).animate;
  });

  it("renders a complete safe snapshot immediately as semantic HTML", () => {
    const preference = reducedMotionQuery(true);
    vi.stubGlobal("matchMedia", preference.matchMedia);

    const { container } = render(
      <Smoothstream>
        {"A **complete** paragraph with [a link](https://example.com)."}
      </Smoothstream>,
    );

    const root = container.querySelector("[data-smoothstream]");
    expect(root).toHaveAttribute("data-smoothstream-motion", "none");
    expect(root).toHaveStyle({
      "--smoothstream-duration": "0ms",
      "--smoothstream-interval": "0ms",
    });
    expect(container.querySelector("p")).toHaveTextContent(
      "A complete paragraph with a link.",
    );
    expect(container.querySelector("strong")).toHaveTextContent("complete");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-smoothstream-kind]")).toHaveLength(0);
  });

  it("announces a reduced-motion response after input closes", async () => {
    const view = render(
      <Smoothstream
        receiving
        motion="none"
      >
        {"Immediately readable.\n\n"}
      </Smoothstream>,
    );
    const announcer = document.body.querySelector(
      "[data-smoothstream-announcer]",
    );

    expect(announcer).toBeEmptyDOMElement();

    act(() => view.rerender(
      <Smoothstream
        receiving={false}
        motion="none"
      >
        {"Immediately readable.\n\n"}
      </Smoothstream>,
    ));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(document.body.querySelector("[data-smoothstream-announcer]"))
      .toHaveTextContent("Content ready.");
  });

  it("can disable motion when the system allows animation", () => {
    const preference = reducedMotionQuery(false);
    vi.stubGlobal("matchMedia", preference.matchMedia);

    const { container } = render(
      <Smoothstream motion="none">{"Motion disabled."}</Smoothstream>,
    );

    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion-policy",
      "none",
    );
    expect(container.querySelector("p")).toHaveTextContent("Motion disabled.");
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
  });

  it("can force animation when the system prefers reduced motion", () => {
    const preference = reducedMotionQuery(true);
    vi.stubGlobal("matchMedia", preference.matchMedia);

    const { container } = render(
      <Smoothstream motion="animate">{"Forced animation."}</Smoothstream>,
    );

    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion-policy",
      "animate",
    );
    expect(container.querySelector("[data-smoothstream]")).toHaveStyle({
      "--smoothstream-duration": "1000ms",
      "--smoothstream-interval": "3ms",
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);
  });

  it("does not replay a mounted response when its policy changes from none to animate", () => {
    const preference = reducedMotionQuery(false);
    vi.stubGlobal("matchMedia", preference.matchMedia);
    const view = render(
      <Smoothstream motion="none">{"Already visible."}</Smoothstream>,
    );

    act(() => view.rerender(
      <Smoothstream motion="animate">{"Already visible."}</Smoothstream>,
    ));

    expect(view.container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(view.container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
  });

  it("still withholds unstable Markdown and reveals it immediately once safe", () => {
    const preference = reducedMotionQuery(true);
    vi.stubGlobal("matchMedia", preference.matchMedia);
    const incomplete = "Safe paragraph.\n\nRead [the docs](";
    const view = render(
      <Smoothstream receiving>{incomplete}</Smoothstream>,
    );

    expect(view.container).toHaveTextContent("Safe paragraph.");
    expect(view.container).not.toHaveTextContent("[the docs](");
    expect(view.container.querySelector("a")).not.toBeInTheDocument();

    act(() => view.rerender(
      <Smoothstream
        receiving
      >
        {`${incomplete}https://example.com)\n\n`}
      </Smoothstream>,
    ));
    act(() => vi.advanceTimersByTime(16));

    expect(view.container.querySelector("a")).toHaveTextContent("the docs");
    expect(view.container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(view.container.querySelector("a")).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(view.container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
  });

  it("finishes the current response immediately when the system preference changes", () => {
    const preference = reducedMotionQuery(false);
    vi.stubGlobal("matchMedia", preference.matchMedia);
    const { container } = render(
      <Smoothstream>{"abcdefghij"}</Smoothstream>,
    );

    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "animate",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    act(() => preference.dispatch(true));

    expect(container.querySelector("p")).toHaveTextContent("abcdefghij");
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);

    act(() => preference.dispatch(false));
    expect(container.querySelector("[data-smoothstream]")).toHaveAttribute(
      "data-smoothstream-motion",
      "none",
    );
  });

  it("keeps an incomplete table absent, then inserts its semantic grid at once", () => {
    const preference = reducedMotionQuery(true);
    vi.stubGlobal("matchMedia", preference.matchMedia);
    const incomplete = "| Name | State |\n| --- | --- |\n| Alpha | Ready |";
    const view = render(
      <Smoothstream receiving>{incomplete}</Smoothstream>,
    );

    expect(view.container.querySelector("table")).not.toBeInTheDocument();

    act(() => view.rerender(
      <Smoothstream
        receiving
      >
        {`${incomplete}\n\nFollowing paragraph.\n\nTrailing open text`}
      </Smoothstream>,
    ));
    act(() => vi.advanceTimersByTime(16));

    expect(view.container.querySelector("table")).toHaveTextContent(
      "NameStateAlphaReady",
    );
    expect(view.container).toHaveTextContent("Following paragraph.");
    expect(view.container.querySelectorAll("[aria-hidden='true']")).toHaveLength(0);
    expect(view.container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
  });

  it("preserves every GFM table column alignment", () => {
    const table = [
      "| Default | Left | Center | Right |",
      "| --- | :--- | :---: | ---: |",
      "| Plain | Start | Middle | End |",
      "",
    ].join("\n");
    const { container } = render(
      <Smoothstream motion="none">{table}</Smoothstream>,
    );
    const headers = container.querySelectorAll("th");
    const cells = container.querySelectorAll("td");

    expect(headers).toHaveLength(4);
    expect(headers[0]).not.toHaveAttribute("style");
    expect(headers[1]).toHaveStyle("text-align: left");
    expect(headers[2]).toHaveStyle("text-align: center");
    expect(headers[3]).toHaveStyle("text-align: right");
    expect(cells[0]).not.toHaveAttribute("style");
    expect(cells[1]).toHaveStyle("text-align: left");
    expect(cells[2]).toHaveStyle("text-align: center");
    expect(cells[3]).toHaveStyle("text-align: right");
  });

  it("hides an unresolved image accessibly without delaying later text", async () => {
    const preference = reducedMotionQuery(true);
    vi.stubGlobal("matchMedia", preference.matchMedia);

    class MockImage {
      static readonly instances: MockImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(() => Promise.resolve());

      constructor() {
        MockImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockImage);
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });

    const { container } = render(
      <Smoothstream>
        {"![Diagram](/diagram.svg)\n\nLater content."}
      </Smoothstream>,
    );

    const pendingImage = container.querySelector("img");
    const announcer = document.body.querySelector(
      "[data-smoothstream-announcer]",
    );
    expect(pendingImage).toHaveAttribute("aria-hidden", "true");
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    const imageBlock = pendingImage?.parentElement;
    expect(imageBlock?.style.height).toBe("");
    expect(imageBlock?.style.overflow).toBe("");
    expect(container).toHaveTextContent("Later content.");
    expect(announcer).toBeEmptyDOMElement();

    const request = MockImage.instances[0];
    if (!request) {
      throw new Error("Expected the image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 640;
    request.naturalHeight = 360;
    await act(async () => {
      request.onload?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const readyImage = container.querySelector("img");
    expect(readyImage).toHaveAttribute("alt", "Diagram");
    expect(readyImage).not.toHaveAttribute("aria-hidden");
    expect(readyImage).not.toHaveAttribute("data-smoothstream-image");
    expect(readyImage).not.toHaveAttribute("data-smoothstream-unit");
    expect(readyImage?.parentElement).toBe(imageBlock);
    expect(imageBlock?.style.height).toBe("");
    expect(imageBlock?.style.overflow).toBe("");
    expect(animate).not.toHaveBeenCalled();
    expect(document.body.querySelector("[data-smoothstream-announcer]"))
      .toHaveTextContent("Content ready.");
  });
});
