// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";
import { Smoothstream } from "../../packages/react/src/Smoothstream";
import { markdownCases } from "../fixtures/markdown-cases";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderStaticMarkdown = (source: string): string =>
  renderToStaticMarkup(
    toJsxRuntime(parseMarkdown(source), {
      Fragment,
      jsx,
      jsxs,
      passKeys: true,
    }),
  );

const normalizeHtml = (html: string): string => {
  const container = document.createElement("div");
  container.innerHTML = html;
  for (const preload of container.querySelectorAll(
    'link[rel="preload"][as="image"]',
  )) {
    preload.remove();
  }
  for (const wrapper of container.querySelectorAll(
    "[data-smoothstream-table-shell], [data-smoothstream-table-scroll]",
  )) {
    // The containment wrappers are presentation-only; compare the complete
    // semantic table subtree against the ordinary static Markdown result.
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const image of container.querySelectorAll(
    "[data-smoothstream-image-standalone]",
  )) {
    // Smoothstream's optional stylesheet needs a durable hook because CSS
    // :only-child ignores text nodes and misclassifies compacted inline images.
    image.removeAttribute("data-smoothstream-image-standalone");
  }
  for (const element of container.querySelectorAll<HTMLElement>("*")) {
    if (element.hasAttribute("style")) {
      element.setAttribute("style", element.style.cssText);
    }
    const attributes = [...element.attributes]
      .map(({ name, value }) => ({ name, value }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const { name } of attributes) {
      element.removeAttribute(name);
    }
    for (const { name, value } of attributes) {
      element.setAttribute(name, value);
    }
  }
  return container.innerHTML;
};

describe("streaming fixture equivalence", () => {
  it.each(markdownCases)(
    "$name settles to ordinary semantic Markdown HTML",
    async ({ markdown }) => {
      vi.useFakeTimers();
      let now = 0;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(now), 16),
      );
      vi.stubGlobal("cancelAnimationFrame", (id: number) =>
        window.clearTimeout(id),
      );
      class ImmediateImage {
        complete = false;
        decoding = "auto";
        naturalHeight = 360;
        naturalWidth = 640;
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        #src = "";

        get src(): string {
          return this.#src;
        }

        set src(value: string) {
          this.#src = value;
          this.complete = true;
          this.onload?.();
        }

        decode(): Promise<void> {
          return Promise.resolve();
        }
      }
      vi.stubGlobal("Image", ImmediateImage);

      const { container } = render(
        <Smoothstream>{markdown}</Smoothstream>,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        now = 100_000;
        await vi.runAllTimersAsync();
      });

      const streamRoot = container.querySelector("[data-smoothstream]");
      expect(streamRoot).not.toBeNull();
      expect(streamRoot?.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
        0,
      );
      expect(normalizeHtml(streamRoot?.innerHTML ?? "")).toBe(
        normalizeHtml(renderStaticMarkdown(markdown)),
      );
    },
  );
});
