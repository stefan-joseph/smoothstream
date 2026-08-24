// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Smoothstream } from "../../packages/react/src/Smoothstream";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settlement invariance", () => {
  it("preserves inline semantic elements when their paragraph compacts", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id)
    );

    const source = [
      "Text before **strong text**, *emphasis*, ~~deleted text~~,",
      "[a link](https://example.com/docs), and `inline code` after it.",
    ].join(" ");
    const renderedText = [
      "Text before strong text, emphasis, deleted text,",
      "a link, and inline code after it.",
    ].join(" ");
    const { container } = render(
      <Smoothstream
        duration={2_000}
        interval={1}
        reducedMotion="never"
      >
        {source}
      </Smoothstream>,
    );

    await act(async () => {
      now = 500;
      await vi.advanceTimersByTimeAsync(512);
    });

    const selectors = ["p", "strong", "em", "del", "a", "code"] as const;
    const activeElements = new Map(
      selectors.map((selector) => [
        selector,
        container.querySelector(selector),
      ]),
    );
    for (const element of activeElements.values()) {
      expect(element).not.toBeNull();
    }
    expect(container.querySelector("p")).toHaveTextContent(renderedText);
    expect(container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    await act(async () => {
      now = 5_000;
      await vi.runAllTimersAsync();
    });

    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    for (const [selector, activeElement] of activeElements) {
      expect(container.querySelector(selector)).toBe(activeElement);
    }
    expect(container.querySelector("p")).toHaveTextContent(renderedText);
  });
});
