// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parseMarkdownSpy = vi.hoisted(() => vi.fn());

vi.mock("../../packages/core/src/markdown/parse", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../packages/core/src/markdown/parse")
  >();
  return {
    ...actual,
    parseMarkdown: (source: string) => {
      parseMarkdownSpy(source);
      return actual.parseMarkdown(source);
    },
  };
});

import { Smoothstream } from "../../packages/react/src/Smoothstream";

describe("Smoothstream input coalescing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    parseMarkdownSpy.mockClear();
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
  });

  it("parses only the latest source snapshot received before a frame", () => {
    const view = render(
      <Smoothstream receiving>{""}</Smoothstream>,
    );

    expect(parseMarkdownSpy.mock.calls.map(([source]) => source)).toEqual([""]);

    act(() => view.rerender(<Smoothstream receiving>{"a"}</Smoothstream>));
    act(() => view.rerender(<Smoothstream receiving>{"ab"}</Smoothstream>));
    act(() => view.rerender(<Smoothstream receiving>{"abc"}</Smoothstream>));

    expect(parseMarkdownSpy.mock.calls.map(([source]) => source)).toEqual([""]);

    act(() => vi.advanceTimersByTime(16));

    expect(parseMarkdownSpy.mock.calls.map(([source]) => source)).toEqual([
      "",
      "abc",
    ]);
  });

  it("flushes the latest source and closed-input state together", () => {
    const view = render(
      <Smoothstream receiving>{""}</Smoothstream>,
    );

    act(() => view.rerender(
      <Smoothstream receiving>{"unfinished"}</Smoothstream>,
    ));
    act(() => view.rerender(
      <Smoothstream receiving={false}>{"unfinished"}</Smoothstream>,
    ));
    act(() => vi.advanceTimersByTime(16));

    expect(parseMarkdownSpy.mock.calls.map(([source]) => source)).toEqual([
      "",
      "unfinished",
    ]);
    act(() => vi.advanceTimersByTime(64));
    expect(view.container.querySelector("p")).toHaveTextContent("unfinished");
  });

  it("rejects a replacement hidden between two coalesced snapshots", () => {
    const view = render(
      <Smoothstream receiving>{"a"}</Smoothstream>,
    );

    act(() => view.rerender(<Smoothstream receiving>{"ab"}</Smoothstream>));

    expect(() => {
      act(() => view.rerender(
        <Smoothstream receiving>{"ax"}</Smoothstream>,
      ));
    }).toThrow(/append-only/);
  });
});
