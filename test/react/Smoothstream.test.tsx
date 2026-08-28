// @vitest-environment jsdom

import type { Root } from "hast";
import type { ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RevealScheduler } from "../../packages/core/src/scheduler";
import type { CodeHighlighter } from "../../packages/core/src/code-types";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";
import { createMarkdownPlan } from "../../packages/core/src/markdown/unitize";
import { Smoothstream as PackageSmoothstream } from "../../packages/react/src/Smoothstream";
import {
  createHastRenderCache,
  renderHast,
} from "../../packages/react/src/render-hast";

/*
 * Most fake-clock tests exercise reveal behavior rather than public defaults.
 * Keep their established cadence explicit so changing package defaults does
 * not rewrite every scenario's clock assertions.
 */
const Smoothstream = (
  props: ComponentProps<typeof PackageSmoothstream>,
) => (
  <PackageSmoothstream duration={400} interval={5} {...props} />
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: Element["animate"] }).animate;
  delete (HTMLElement.prototype as { getAnimations?: Element["getAnimations"] })
    .getAnimations;
});

describe("Smoothstream", () => {
  it("applies the default theme unless an instance opts out", () => {
    const view = render(
      <Smoothstream reducedMotion="always">{"A themed response."}</Smoothstream>,
    );
    const root = view.container.querySelector("[data-smoothstream]");

    expect(root).toHaveAttribute("data-smoothstream-theme", "default");

    view.rerender(
      <Smoothstream
        reducedMotion="always"
        unstyled
      >
        {"A themed response."}
      </Smoothstream>,
    );

    expect(root).not.toHaveAttribute("data-smoothstream-theme");
    expect(root).toHaveAttribute("data-smoothstream-motion", "none");
    expect(root).toHaveAttribute("data-smoothstream-mode", "streaming");
  });

  it("renders static Markdown immediately without disabling interactive motion", () => {
    const { container } = render(
      <Smoothstream mode="static" reducedMotion="never">
        {"A **completed** response."}
      </Smoothstream>,
    );
    const root = container.querySelector("[data-smoothstream]");

    expect(root).toHaveAttribute("data-smoothstream-mode", "static");
    expect(root).toHaveAttribute("data-smoothstream-motion", "animate");
    expect(root).toHaveStyle({
      "--smoothstream-duration": "400ms",
      "--smoothstream-interval": "5ms",
    });
    expect(container.querySelector("p")).toHaveTextContent(
      "A completed response.",
    );
    expect(container.querySelector("strong")).toHaveTextContent("completed");
    expect(container.querySelector("[data-smoothstream-unit]")).toBeNull();
    expect(document.body.querySelector("[data-smoothstream-announcer]"))
      .toBeNull();
  });

  it("normalizes HAST properties without the generic JSX conversion pass", () => {
    const tree: Root = {
      type: "root",
      children: [{
        type: "element",
        tagName: "label",
        properties: {
          className: ["first-class", "second-class"],
          htmlFor: ["example-field"],
        },
        children: [{ type: "text", value: "Example" }],
      }],
    };

    const { container } = render(
      <div>{renderHast(tree, new Map(), 0, new Set(), new Map())}</div>,
    );
    const label = container.querySelector("label");

    expect(label).toHaveClass("first-class", "second-class");
    expect(label).toHaveAttribute("for", "example-field");
    expect(label).toHaveTextContent("Example");
  });

  it("does not rebuild an unchanged top-level block for a later source snapshot", () => {
    const firstSource = "Stable first block.\n\nSecond";
    const secondSource = `${firstSource} block`;
    const firstPlan = createMarkdownPlan(parseMarkdown(firstSource), firstSource, {
      inputOpen: true,
    });
    const secondPlan = createMarkdownPlan(
      parseMarkdown(secondSource),
      secondSource,
      { inputOpen: true },
    );
    const schedule = (plan: typeof firstPlan) => {
      const units = new RevealScheduler({ now: () => 0 }, {
        duration: 400,
        interval: 5,
      }).enqueue(plan.units);
      return new Map(units.map((unit) => [unit.id, unit]));
    };
    const firstSchedules = schedule(firstPlan);
    const secondSchedules = schedule(secondPlan);
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    const renderPlan = (
      plan: typeof firstPlan,
      schedules: ReturnType<typeof schedule>,
    ) => renderHast(
      plan.tree,
      schedules,
      0,
      new Set(),
      new Map(),
      createHastRenderCache(),
      1,
      plan.units,
    );

    const view = render(
      <div>{renderPlan(firstPlan, firstSchedules)}</div>,
    );
    const firstBlockCalls = segment.mock.calls.filter(
      ([value]) => value === "Stable first block.",
    ).length;
    expect(firstBlockCalls).toBeGreaterThan(0);

    view.rerender(
      <div>{renderPlan(secondPlan, secondSchedules)}</div>,
    );
    expect(
      segment.mock.calls.filter(
        ([value]) => value === "Stable first block.",
      ),
    ).toHaveLength(firstBlockCalls);
  });

  it("reuses resolved text schedules while a later block advances", () => {
    const source = [
      "Stable first block.",
      "",
      "A much longer second block keeps revealing while the first block has already settled completely.",
    ].join("\n");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const scheduled = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    }).enqueue(plan.units);
    const schedules = new Map(scheduled.map((unit) => [unit.id, unit]));
    const scheduleLookup = vi.spyOn(schedules, "get");
    const cache = createHastRenderCache();
    const compacted = new Set<string>();
    const visibleAt = (now: number) =>
      scheduled.filter((unit) => unit.startAt <= now).length;
    const renderAt = (now: number) => renderHast(
      plan.tree,
      schedules,
      now,
      compacted,
      new Map(),
      cache,
      visibleAt(now),
      plan.units,
    );

    const view = render(<div>{renderAt(600)}</div>);
    expect(scheduleLookup).toHaveBeenCalled();
    scheduleLookup.mockClear();

    view.rerender(<div>{renderAt(620)}</div>);

    expect(scheduleLookup).not.toHaveBeenCalled();
  });

  it("reuses resolved code schedules while a fenced block advances", () => {
    const fence = "`".repeat(3);
    const source = `${fence}ts\nab cd\n${fence}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const scheduled = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    }).enqueue(plan.units);
    const schedules = new Map(scheduled.map((unit) => [unit.id, unit]));
    const scheduleLookup = vi.spyOn(schedules, "get");
    const cache = createHastRenderCache();
    const visibleAt = (now: number) =>
      scheduled.filter((unit) => unit.startAt <= now).length;
    const renderAt = (now: number) => renderHast(
      plan.tree,
      schedules,
      now,
      new Set(),
      new Map(),
      cache,
      visibleAt(now),
      plan.units,
    );

    const view = render(<div>{renderAt(11)}</div>);
    expect(view.container.querySelector("code")).toHaveTextContent("a");
    expect(scheduleLookup).toHaveBeenCalled();
    scheduleLookup.mockClear();

    view.rerender(<div>{renderAt(26)}</div>);

    expect(view.container.querySelector("code")?.textContent).toBe("ab c\n");
    expect(scheduleLookup).not.toHaveBeenCalled();
  });

  it("reuses grapheme segmentation while a source snapshot keeps revealing", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");

    render(<Smoothstream>{"A stable paragraph keeps revealing."}</Smoothstream>);
    await act(async () => {
      now = 32;
      await vi.advanceTimersByTimeAsync(32);
    });
    const callsAfterFirstPlaybackFrame = segment.mock.calls.length;
    expect(callsAfterFirstPlaybackFrame).toBeGreaterThan(0);

    await act(async () => {
      now = 64;
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(segment).toHaveBeenCalledTimes(callsAfterFirstPlaybackFrame);
  });

  it("reveals complete Markdown and compacts it to semantic HTML", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <PackageSmoothstream>{"Hello **world**"}</PackageSmoothstream>,
    );

    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(screen.getByText("H")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:0:1",
    );
    expect(screen.getByText("H")).toHaveStyle(
      "--smoothstream-duration: 1000ms",
    );

    await act(async () => {
      now = 100;
      await vi.advanceTimersByTimeAsync(112);
    });
    expect(screen.getByText("w")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:8:9",
    );
    expect(container.querySelector("strong")).toHaveTextContent("world");

    await act(async () => {
      now = 2_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    expect(container.querySelector("p")).toHaveTextContent("Hello world");
  });

  it("announces completion only after input closes and the DOM compacts", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const view = render(
      <Smoothstream receiving reducedMotion="never">{"unfinished"}</Smoothstream>,
    );
    const announcer = document.body.querySelector(
      "[data-smoothstream-announcer]",
    );

    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveAttribute("aria-atomic", "true");
    expect(announcer).toHaveAttribute("role", "status");
    expect(announcer).toBeEmptyDOMElement();

    view.rerender(
      <Smoothstream receiving={false} reducedMotion="never">{"unfinished"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(view.container.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);
    expect(announcer).toBeEmptyDOMElement();

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });

    expect(view.container.querySelectorAll("[data-smoothstream-unit]"))
      .toHaveLength(0);
    expect(announcer).toHaveTextContent("Content ready.");
    expect(view.container).not.toHaveTextContent("Content ready.");
  });

  it("does not announce while completed blocks can still receive input", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const view = render(
      <Smoothstream receiving reducedMotion="never">{"Complete.\n\n"}</Smoothstream>,
    );
    const announcer = document.body.querySelector(
      "[data-smoothstream-announcer]",
    );

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });

    expect(view.container.querySelectorAll("[data-smoothstream-unit]"))
      .toHaveLength(0);
    expect(announcer).toBeEmptyDOMElement();

    view.rerender(
      <Smoothstream
        receiving={false}
        reducedMotion="never"
      >
        {"Complete.\n\n"}
      </Smoothstream>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(document.body.querySelector("[data-smoothstream-announcer]"))
      .toHaveTextContent("Content ready.");
  });

  it("continues one schedule across appended transport packets", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container, rerender } = render(
      <Smoothstream receiving>{"Hello\n\n"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    const firstCharacter = container.querySelector(
      '[data-smoothstream-unit="text:0:1"]',
    );

    now = 10;
    rerender(<Smoothstream receiving>{"Hello\n\nworld\n\n"}</Smoothstream>);
    expect(screen.getByText("H")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:0:1",
    );
    expect(
      container.querySelector('[data-smoothstream-unit="text:0:1"]'),
    ).toBe(firstCharacter);
    expect(container).not.toHaveTextContent("world");

    await act(async () => {
      now = 26;
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(screen.getByText("w")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:7:8",
    );
    expect(screen.getByText("H")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:0:1",
    );
    expect(
      container.querySelector('[data-smoothstream-unit="text:0:1"]'),
    ).toBe(firstCharacter);
    expect(container).toHaveTextContent("Hello w");
  });

  it("preserves spaces across inline Markdown boundaries", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>{"Hello *beautiful* world"}</Smoothstream>,
    );
    await act(async () => {
      now = 500;
      await vi.advanceTimersByTimeAsync(512);
    });

    expect(container.querySelector("p")?.textContent).toBe(
      "Hello beautiful world",
    );
  });

  it("flushes the retained source tail when input closes", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { rerender } = render(
      <Smoothstream receiving>{"unfinished"}</Smoothstream>,
    );
    expect(screen.queryByText("unfinished")).not.toBeInTheDocument();

    rerender(<Smoothstream receiving={false}>{"unfinished"}</Smoothstream>);
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(screen.getByText("u")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:0:1",
    );
  });

  it("uses the configured grapheme interval and duration", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream duration={20} interval={50}>{"ab"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(screen.getByText("a")).toHaveStyle(
      "--smoothstream-duration: 20ms",
    );
    expect(container.querySelector("[data-smoothstream]")).toHaveStyle({
      "--smoothstream-duration": "20ms",
      "--smoothstream-interval": "50ms",
    });
    expect(container).not.toHaveTextContent("b");

    await act(async () => {
      now = 51;
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(screen.getByText("b")).toHaveAttribute(
      "data-smoothstream-unit",
      "text:1:2",
    );

    await act(async () => {
      now = 100;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    expect(container.querySelector("p")).toHaveTextContent("ab");
  });

  it("reveals each stable table row before filling it character by character", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const table = [
      "| Product | Revenue |",
      "| --- | ---: |",
      "| Almond | $12k |",
      "| Cream | $9k |",
    ].join("\n");
    const { container, rerender } = render(
      <Smoothstream receiving>{table}</Smoothstream>,
    );
    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(
      container.querySelector("[data-smoothstream-table-shell]"),
    ).not.toBeInTheDocument();

    rerender(<Smoothstream receiving>{`${table}\n\nNext`}</Smoothstream>);
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    const tableShell = container.querySelector<HTMLElement>(
      "[data-smoothstream-table-shell]",
    );
    const tableScroll = container.querySelector<HTMLElement>(
      "[data-smoothstream-table-scroll]",
    );
    expect(tableShell).toContainElement(tableScroll);
    expect(tableScroll).toContainElement(container.querySelector("table"));
    expect(container.querySelectorAll("tr")).toHaveLength(3);
    const headerRow = container.querySelector("thead tr");
    const [almondRow, creamRow] = container.querySelectorAll("tbody tr");
    expect(headerRow).toBeVisible();
    expect(headerRow).toHaveTextContent("ProductRevenue");
    expect(almondRow).not.toBeVisible();
    expect(almondRow).toHaveAttribute("data-smoothstream-state", "pending");
    expect(almondRow).toHaveAttribute("aria-hidden", "true");
    expect(almondRow?.querySelector("td")).not.toHaveAttribute("style");
    expect(creamRow).not.toBeVisible();
    const firstHeaderCharacter = headerRow?.querySelector(
      '[data-smoothstream-unit="text:2:3"]',
    );
    expect(firstHeaderCharacter).not.toBeVisible();
    const firstHeaderCell = headerRow?.querySelector("th");
    expect(firstHeaderCell).not.toHaveAttribute("data-smoothstream-cell");
    expect(firstHeaderCell).not.toHaveAttribute("style");

    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("thead tr")).toBe(headerRow);
    expect(container.querySelector("[data-smoothstream-table-shell]")).toBe(
      tableShell,
    );
    expect(container.querySelector("[data-smoothstream-table-scroll]")).toBe(
      tableScroll,
    );
    expect(container.querySelector('[data-smoothstream-unit="text:2:3"]')).toBe(
      firstHeaderCharacter,
    );
    expect(firstHeaderCharacter).toBeVisible();
    expect(firstHeaderCharacter).toHaveAttribute(
      "data-smoothstream-kind",
      "text",
    );
    expect(almondRow).not.toBeVisible();
    expect(creamRow).not.toBeVisible();

    await act(async () => {
      now = 86;
      await vi.advanceTimersByTimeAsync(80);
    });
    expect(container.querySelector("thead tr")).toBe(headerRow);
    expect(container.querySelectorAll("tbody tr")[0]).toBe(almondRow);
    expect(container.querySelectorAll("tbody tr")[1]).toBe(creamRow);
    expect(almondRow).toBeVisible();
    expect(almondRow).toHaveAttribute("data-smoothstream-kind", "table-row");
    expect(creamRow).not.toBeVisible();
    expect(creamRow).toHaveStyle("visibility: collapse");

    const firstAlmondCharacter = Array.from(
      almondRow?.querySelectorAll('[data-smoothstream-state="pending"]') ?? [],
    ).find((element) => element.textContent === "A");
    expect(firstAlmondCharacter).not.toBeVisible();

    await act(async () => {
      now = 96;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelectorAll("tbody tr")[0]).toBe(almondRow);
    expect(firstAlmondCharacter).toBeVisible();
    expect(creamRow).not.toBeVisible();

    await act(async () => {
      now = 151;
      await vi.advanceTimersByTimeAsync(64);
    });
    expect(container.querySelectorAll("tbody tr")[1]).toBe(creamRow);
    expect(creamRow).toBeVisible();
    const firstCreamCharacter = Array.from(
      creamRow?.querySelectorAll('[data-smoothstream-state="pending"]') ?? [],
    ).find((element) => element.textContent === "C");
    expect(firstCreamCharacter).not.toBeVisible();

    await act(async () => {
      now = 161;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector('[data-smoothstream-unit="text:57:58"]')).toBe(
      firstCreamCharacter,
    );
    expect(firstCreamCharacter).toBeVisible();

    await act(async () => {
      now = 401;
      await vi.advanceTimersByTimeAsync(240);
    });
    expect(container.querySelector("thead tr")).toBe(headerRow);
    expect(headerRow).toHaveAttribute("data-smoothstream-kind", "table-row");
    expect(headerRow).toHaveAttribute("data-smoothstream-state", "settled");
    expect(firstHeaderCell).not.toHaveAttribute("data-smoothstream-cell");
    expect(firstHeaderCell).not.toHaveAttribute("style");

    await act(async () => {
      now = 2_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    expect(container.querySelector("table")).toHaveTextContent(
      "ProductRevenueAlmond$12kCream$9k",
    );
  });

  it("retains complete pending words for stable table geometry in word mode", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const source = [
      "| Product name | Revenue |",
      "| --- | ---: |",
      "| Smoothstream | $12k |",
    ].join("\n");
    const { container } = render(
      <Smoothstream reducedMotion="never" reveal="word">{source}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    const pendingProduct = Array.from(
      container.querySelectorAll('[data-smoothstream-state="pending"]'),
    ).find((element) => element.textContent === "Product");
    expect(pendingProduct).not.toBeVisible();
    expect(pendingProduct).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });
    const visibleProduct = Array.from(
      container.querySelectorAll("[data-smoothstream-word]"),
    ).find((element) => element.textContent === "Product");
    expect(visibleProduct).toBeVisible();
    expect(visibleProduct).not.toHaveAttribute(
      "data-smoothstream-remainder",
    );
  });

  it("retains pending inline elements when their table row becomes visible", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const source = [
      "| Feature | Example | Notes |",
      "| --- | --- | --- |",
      "| Emphasis | **bold** | Semantic text |",
      "| Code | `npm install @smoothstream/react` | Stable geometry |",
      "",
      "After the table.",
    ].join("\n");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const plannedSchedules = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    }).enqueue(plan.units);
    const codeRowStart = source.indexOf("| Code |");
    const inlineCodeStart = source.indexOf("`npm install");
    const codeRowSchedule = plannedSchedules.find((schedule) =>
      schedule.id.startsWith(`table-row:${codeRowStart}:`),
    );
    const inlineCodeSchedule = plannedSchedules.find((schedule) =>
      schedule.id.startsWith(`inline:${inlineCodeStart}:`),
    );

    expect(codeRowSchedule).toBeDefined();
    expect(inlineCodeSchedule).toBeDefined();
    expect(inlineCodeSchedule?.startAt).toBeGreaterThan(
      codeRowSchedule?.startAt ?? 0,
    );

    const { container } = render(
      <Smoothstream reducedMotion="never">{source}</Smoothstream>,
    );

    await act(async () => {
      now = codeRowSchedule?.startAt ?? 0;
      await vi.advanceTimersByTimeAsync(16);
    });

    const codeRow = Array.from(container.querySelectorAll("tbody tr")).find(
      (row) => row.textContent?.includes("Code"),
    );
    const pendingCode = codeRow?.querySelector("code");
    expect(codeRow).toBeVisible();
    expect(pendingCode).toHaveTextContent("npm install @smoothstream/react");
    expect(pendingCode).toHaveAttribute("aria-hidden", "true");
    expect(pendingCode).toHaveAttribute("data-smoothstream-state", "pending");
    expect(pendingCode).toHaveStyle("visibility: hidden");

    await act(async () => {
      now = inlineCodeSchedule?.startAt ?? now;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(codeRow?.querySelector("code")).toBe(pendingCode);
    expect(pendingCode).not.toHaveAttribute("aria-hidden");
    expect(pendingCode).not.toHaveStyle("visibility: hidden");
  });

  it("keeps a confirmed table out of layout until its header reveal", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const table = [
      "| Product | Revenue |",
      "| --- | ---: |",
      "| Smoothstream | $12k |",
      "| Cream | $9k |",
    ].join("\n");
    const { container } = render(
      <Smoothstream>{`Before\n\n${table}\n\nNext`}</Smoothstream>,
    );

    await act(async () => {
      now = 26;
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(container).toHaveTextContent("Before");
    expect(container.querySelector("table")).not.toBeInTheDocument();

    await act(async () => {
      now = 31;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelectorAll("tr")).toHaveLength(3);
    const headerRow = container.querySelector("thead tr");
    const [smoothstreamRow, creamRow] = container.querySelectorAll("tbody tr");
    expect(headerRow).toBeVisible();
    expect(headerRow).toHaveTextContent("ProductRevenue");
    expect(
      headerRow?.querySelector('[data-smoothstream-state="pending"]'),
    ).not.toBeVisible();
    expect(smoothstreamRow).toHaveStyle(
      "visibility: collapse",
    );
    expect(creamRow).toHaveStyle(
      "visibility: collapse",
    );
  });

  it("admits complete code lines and reveals their characters", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const fence = "`".repeat(3);
    const source = `${fence}ts\nab cd\n${fence}`;
    const { container } = render(<Smoothstream>{source}</Smoothstream>);

    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("pre code")).toBeInTheDocument();
    expect(container.querySelector("[data-smoothstream-code-block]"))
      .not.toBeInTheDocument();
    expect(
      container.querySelector('[data-smoothstream-code-line="true"]'),
    ).toHaveAttribute("data-smoothstream-unit", "code-line:0:0");
    expect(container.querySelector("code")).not.toHaveTextContent("a");

    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("code")).toHaveTextContent("a");
    expect(container.querySelector("code span span")).toHaveAttribute(
      "data-smoothstream-unit",
      "code-character:0:0:0",
    );

    await act(async () => {
      now = 26;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("code")?.textContent).toBe("ab c\n");

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    expect(container.querySelector("code")?.textContent).toBe("ab cd\n");
  });

  it("reveals fenced code nested inside list items", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const fence = "`".repeat(3);
    const source = [
      "1. Outer ordered item.",
      "",
      `   ${fence}ts`,
      "   const nested = true;",
      `   ${fence}`,
      "",
    ].join("\n");
    const { container } = render(<Smoothstream>{source}</Smoothstream>);

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector("ol li pre code")).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "const nested = true;\n",
    );
  });

  it("waits for highlighted tokens before revealing a fenced code line", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    let resolveHighlight: ((result: Awaited<ReturnType<
      CodeHighlighter["highlight"]
    >>) => void) | undefined;
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const codeHighlighter: CodeHighlighter = {
      name: "test",
      highlight: vi.fn(() => new Promise<Awaited<ReturnType<
        CodeHighlighter["highlight"]
      >>>((resolve) => {
        resolveHighlight = resolve;
      })),
    };
    const fence = "`".repeat(3);
    const source = `${fence}ts\nconst ready = true;\n${fence}`;
    const { container } = render(
      <Smoothstream
        codeHighlighter={codeHighlighter}
        reducedMotion="never"
      >
        {source}
      </Smoothstream>,
    );

    await act(async () => Promise.resolve());
    expect(codeHighlighter.highlight).toHaveBeenCalledWith({
      code: "const ready = true;\n",
      language: "ts",
      session: expect.any(Object),
    });
    expect(container.querySelector("pre code")).not.toBeInTheDocument();

    resolveHighlight?.({
      lines: [{
        tokens: [
          { content: "const", style: { color: "rgb(0, 0, 255)" } },
          { content: " ready = true;", style: { color: "rgb(160, 0, 0)" } },
        ],
      }],
      languageLabel: "TypeScript",
      palette: {
        backgroundColor: "rgb(1, 2, 3)",
        color: "rgb(240, 241, 242)",
        style: {
          "--shiki-dark": "rgb(210, 211, 212)",
          "--shiki-dark-bg": "rgb(4, 5, 6)",
        },
      },
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });

    const firstToken = container.querySelector(
      '[data-smoothstream-code-token="0:0:0"]',
    );
    const codeSurface = container.querySelector("pre");
    expect(codeSurface).toHaveAttribute("data-smoothstream-code-block");
    expect(codeSurface).toHaveAttribute("data-smoothstream-code-theme");
    expect(codeSurface?.style.getPropertyValue(
      "--smoothstream-shiki-background",
    )).toBe("rgb(1, 2, 3)");
    expect(codeSurface?.style.getPropertyValue(
      "--smoothstream-shiki-color",
    )).toBe("rgb(240, 241, 242)");
    expect(codeSurface?.style.getPropertyValue("--shiki-dark")).toBe(
      "rgb(210, 211, 212)",
    );
    expect(codeSurface?.style.getPropertyValue("--shiki-dark-bg")).toBe(
      "rgb(4, 5, 6)",
    );
    const toolbar = container.querySelector(
      "[data-smoothstream-code-toolbar]",
    );
    expect(toolbar).toBeInTheDocument();
    expect(toolbar?.parentElement).toBe(codeSurface);
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    const copyButton = container.querySelector(
      "[data-smoothstream-code-copy]",
    );
    expect(copyButton).toBeEnabled();
    expect(copyButton).toHaveAttribute("data-smoothstream-ready", "true");
    expect(copyButton).not.toHaveAttribute("aria-hidden");
    expect(firstToken).toHaveStyle({ color: "rgb(0, 0, 255)" });
    expect(firstToken).toHaveTextContent("c");

    await act(async () => {
      fireEvent.click(copyButton as Element);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("const ready = true;");

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelector("code")?.textContent).toBe(
      "const ready = true;\n",
    );
    expect(
      container.querySelectorAll('[data-smoothstream-unit^="code-character"]'),
    ).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-smoothstream-code-token]"),
    ).toHaveLength(2);
    expect(copyButton).toBeEnabled();
    expect(copyButton).not.toHaveAttribute("aria-hidden");

    await act(async () => {
      fireEvent.click(copyButton as Element);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("const ready = true;");
    expect(copyButton).toHaveAccessibleName("Code copied");
    expect(
      copyButton?.querySelector("[data-smoothstream-code-icon-swap]"),
    ).toHaveAttribute("data-state", "check");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(copyButton).toHaveAccessibleName("Copy TypeScript code");
    expect(
      copyButton?.querySelector("[data-smoothstream-code-icon-swap]"),
    ).toHaveAttribute("data-state", "copy");
  });

  it("keeps one private highlighting session while a fenced block grows", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    const sessions: object[] = [];
    const codeHighlighter: CodeHighlighter = {
      name: "test",
      highlight: vi.fn((request) => {
        sessions.push(request.session);
        return {
          lines: request.code.split("\n").slice(0, -1).map((line: string) => ({
            tokens: line.length > 0 ? [{ content: line }] : [],
          })),
          palette: {
            backgroundColor: sessions.length === 1 ? "#ffffff" : "#000000",
            color: sessions.length === 1 ? "#111111" : "#eeeeee",
          },
        };
      }),
    };
    const fence = "`".repeat(3);
    const { container, rerender } = render(
      <Smoothstream
        codeHighlighter={codeHighlighter}
        receiving
        reducedMotion="always"
      >
        {`${fence}ts\nfirst();\n`}
      </Smoothstream>,
    );

    await waitFor(() => expect(codeHighlighter.highlight).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(container.querySelector("pre")?.style.getPropertyValue(
        "--smoothstream-shiki-background",
      )).toBe("#ffffff");
    });
    rerender(
      <Smoothstream
        codeHighlighter={codeHighlighter}
        receiving
        reducedMotion="always"
      >
        {`${fence}ts\nfirst();\nsecond();\n${fence}\n`}
      </Smoothstream>,
    );
    await waitFor(() => expect(codeHighlighter.highlight).toHaveBeenCalledTimes(2));

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toBe(sessions[1]);
    expect(container.querySelector("pre")?.style.getPropertyValue(
      "--smoothstream-shiki-background",
    )).toBe("#ffffff");
  });

  it("lets a late standalone image take its natural layout without a height animation", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    let resolveDecode: (() => void) | undefined;
    class MockPreloadedImage {
      static readonly instances: MockPreloadedImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(
        () => new Promise<void>((resolve) => {
          resolveDecode = resolve;
        }),
      );

      constructor() {
        MockPreloadedImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockPreloadedImage);

    const source =
      "![Diagram](/diagram.svg)\n\nLater content keeps revealing.";
    const { container } = render(
      <Smoothstream duration={400} reducedMotion="never">{source}</Smoothstream>,
    );
    await act(async () => {
      now = 100;
      await vi.advanceTimersByTimeAsync(112);
    });

    expect(MockPreloadedImage.instances).toHaveLength(1);
    expect(MockPreloadedImage.instances[0]?.src).toBe("/diagram.svg");
    const pendingImage = screen.getByAltText("Diagram");
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(pendingImage).toHaveAttribute("aria-hidden", "true");
    expect(pendingImage).toHaveStyle({
      display: "block",
      visibility: "hidden",
    });
    expect(pendingImage.parentElement?.style.height).toBe("");
    expect(pendingImage.parentElement?.style.overflow).toBe("");
    expect(container).toHaveTextContent("Later");

    const request = MockPreloadedImage.instances[0];
    if (!request) {
      throw new Error("Expected the image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 640;
    request.naturalHeight = 360;
    await act(async () => {
      now = 200;
      request.onload?.();
      request.onload?.();
      await Promise.resolve();
    });
    expect(request.decode).toHaveBeenCalledOnce();
    expect(screen.getByAltText("Diagram")).toBe(pendingImage);
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(pendingImage.parentElement?.style.height).toBe("");
    expect(pendingImage.parentElement?.style.overflow).toBe("");

    await act(async () => {
      resolveDecode?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const image = screen.getByAltText("Diagram");
    expect(image).toBe(pendingImage);
    expect(image).toHaveAttribute("data-smoothstream-image-standalone");
    expect(image).toHaveAttribute("data-smoothstream-kind", "image");
    expect(image).toHaveAttribute("data-smoothstream-image", "ready");
    expect(image).not.toHaveAttribute("data-smoothstream-image-layout");
    expect(image).toHaveAttribute("data-smoothstream-animation-start", "200");
    expect(image).toHaveAttribute("width", "640");
    expect(image).toHaveAttribute("height", "360");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image.parentElement?.style.height).toBe("");
    expect(image.parentElement?.style.overflow).toBe("");

    await act(async () => {
      now = 1_000;
      await vi.advanceTimersByTimeAsync(800);
    });
    const settledImage = screen.getByAltText("Diagram");
    expect(settledImage).toBe(image);
    expect(settledImage).toHaveAttribute(
      "data-smoothstream-image-standalone",
    );
    expect(settledImage).not.toHaveAttribute("data-smoothstream-unit");
    expect(settledImage).not.toHaveAttribute("data-smoothstream-image");
    expect(settledImage).not.toHaveAttribute(
      "data-smoothstream-image-layout",
    );
    expect(settledImage).not.toHaveAttribute("width");
    expect(settledImage).not.toHaveAttribute("height");
    expect(settledImage).not.toHaveAttribute("decoding");
  });

  it("leaves CSS-reserved image geometry untouched through a late decode", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    class MockCssSizedImage {
      static readonly instances: MockCssSizedImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(() => Promise.resolve());

      constructor() {
        MockCssSizedImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockCssSizedImage);

    const layoutAnimations: Array<{
      readonly element: HTMLElement;
      readonly keyframes: Keyframe[];
    }> = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(this: HTMLElement, keyframes: Keyframe[]) {
        layoutAnimations.push({ element: this, keyframes });
        return {
          cancel: vi.fn(),
          finished: new Promise(() => undefined),
        } as unknown as Animation;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height =
          this.tagName === "IMG" || this.tagName === "P" ? 360 : 0;
        return {
          bottom: height,
          height,
          left: 0,
          right: 640,
          top: 0,
          width: 640,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );

    render(
      <Smoothstream>
        {"![Diagram](/diagram.svg)\n\nLater content."}
      </Smoothstream>,
    );
    await act(async () => {
      now = 100;
      await vi.advanceTimersByTimeAsync(112);
    });

    const pendingImage = screen.getByAltText("Diagram");
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(pendingImage).toHaveStyle({
      display: "block",
      visibility: "hidden",
    });
    expect(pendingImage.parentElement?.style.height).toBe("");
    expect(pendingImage.parentElement?.style.overflow).toBe("");
    expect(pendingImage.parentElement?.getBoundingClientRect().height).toBe(
      360,
    );

    const request = MockCssSizedImage.instances[0];
    if (!request) {
      throw new Error("Expected the image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 640;
    request.naturalHeight = 360;
    await act(async () => {
      now = 200;
      request.onload?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const image = screen.getByAltText("Diagram");
    expect(image).toBe(pendingImage);
    expect(image).toHaveAttribute("data-smoothstream-image", "ready");
    expect(image).not.toHaveAttribute("data-smoothstream-image-layout");
    expect(layoutAnimations).toHaveLength(0);
    expect(image.parentElement?.style.height).toBe("");
    expect(image.parentElement?.style.overflow).toBe("");
  });

  it("withholds an inline suffix until the image geometry is ready", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    class MockInlineImage {
      static readonly instances: MockInlineImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(() => Promise.resolve());

      constructor() {
        MockInlineImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockInlineImage);

    const { container } = render(
      <Smoothstream>
        {"Before ![Icon](/icon.svg) after the icon."}
      </Smoothstream>,
    );
    await act(async () => {
      now = 200;
      await vi.advanceTimersByTimeAsync(208);
    });

    const pendingImage = screen.getByAltText("Icon");
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(container).toHaveTextContent("Before");
    expect(container).not.toHaveTextContent("after the icon");

    const request = MockInlineImage.instances[0];
    if (!request) {
      throw new Error("Expected the inline image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 24;
    request.naturalHeight = 24;
    await act(async () => {
      now = 300;
      request.onload?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const image = screen.getByAltText("Icon");
    expect(image).toBe(pendingImage);
    expect(image).not.toHaveAttribute(
      "data-smoothstream-image-standalone",
    );
    expect(image).toHaveAttribute("data-smoothstream-image", "ready");
    expect(image).not.toHaveAttribute("data-smoothstream-image-layout");
    expect(container).toHaveTextContent("after the icon");

    await act(async () => {
      now = 1_000;
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(screen.getByAltText("Icon")).not.toHaveAttribute(
      "data-smoothstream-image-standalone",
    );
  });

  it("reveals an image that was ready before its turn at full layout height", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    class MockReadyImage {
      static readonly instances: MockReadyImage[] = [];
      complete = true;
      decoding = "auto";
      naturalHeight = 360;
      naturalWidth = 640;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(() => Promise.resolve());

      constructor() {
        MockReadyImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockReadyImage);

    const layoutAnimations: Keyframe[][] = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(_keyframes: Keyframe[]) {
        layoutAnimations.push(_keyframes);
        return {
          cancel: vi.fn(),
          finished: new Promise(() => undefined),
        } as unknown as Animation;
      },
    });

    render(
      <Smoothstream>
        {"Before\n\n![Diagram](/diagram.svg)\n\nAfter"}
      </Smoothstream>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockReadyImage.instances).toHaveLength(1);
    expect(screen.queryByAltText("Diagram")).not.toBeInTheDocument();

    await act(async () => {
      now = 31;
      await vi.advanceTimersByTimeAsync(32);
    });

    const image = screen.getByAltText("Diagram");
    expect(image).toHaveAttribute("data-smoothstream-kind", "image");
    expect(image).toHaveAttribute("data-smoothstream-animation-start", "30");
    expect(image).not.toHaveAttribute("data-smoothstream-image-layout");
    expect(image).toHaveAttribute("width", "640");
    expect(image).toHaveAttribute("height", "360");
    expect(layoutAnimations).toHaveLength(0);
  });

  it("reveals a failed native image without blocking subsequent text", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    class MockFailedImage {
      static readonly instances: MockFailedImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";

      constructor() {
        MockFailedImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockFailedImage);

    const { container } = render(
      <Smoothstream>
        {"![Missing](/missing.svg)\n\nLater text is independent."}
      </Smoothstream>,
    );
    await act(async () => {
      now = 100;
      await vi.advanceTimersByTimeAsync(112);
    });
    const pendingImage = screen.getByAltText("Missing");
    expect(pendingImage).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(pendingImage).toHaveAttribute("aria-hidden", "true");
    expect(pendingImage).toHaveStyle({ visibility: "hidden" });
    expect(container).toHaveTextContent("Later");

    await act(async () => {
      now = 200;
      MockFailedImage.instances[0]?.onerror?.();
      await Promise.resolve();
    });
    const failedImage = screen.getByAltText("Missing");
    expect(failedImage).toBe(pendingImage);
    expect(failedImage).toHaveAttribute("src", "/missing.svg");
    expect(failedImage).toHaveAttribute("data-smoothstream-image", "error");
    expect(failedImage).not.toHaveAttribute("width");
    expect(failedImage).not.toHaveAttribute("height");
  });

  it("reveals an open blockquote only when its first child reaches the schedule", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const firstQuote = "Quoted prose ".repeat(7);
    const { container, rerender } = render(
      <Smoothstream receiving>{`Before\n\n> ${firstQuote}`}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("p")).toHaveTextContent("B");
    expect(container.querySelector("blockquote")).not.toBeInTheDocument();

    await act(async () => {
      now = 31;
      await vi.advanceTimersByTimeAsync(32);
    });
    const quote = container.querySelector("blockquote");
    expect(quote).toHaveTextContent("Q");
    expect(quote?.querySelectorAll(":scope > p")).toHaveLength(1);

    now = 40;
    rerender(
      <Smoothstream
        receiving
      >
        {`Before\n\n> ${firstQuote}\n>\n> ${"Second quoted paragraph ".repeat(5)}`}
      </Smoothstream>,
    );
    expect(container.querySelector("blockquote")).toBe(quote);
    expect(quote?.querySelectorAll(":scope > p")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => {
      now = 5_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelector("blockquote")).toBe(quote);
    expect(quote?.querySelectorAll(":scope > p")).toHaveLength(2);
  });

  it("keeps a link absent, then inert, until its label has settled", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>
        {'[Docs](https://example.com "Documentation")'}
      </Smoothstream>,
    );

    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("a")).not.toBeInTheDocument();

    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });
    const link = container.querySelector("a");
    expect(link).toHaveTextContent("D");
    expect(link).not.toHaveAttribute("href");
    expect(link).not.toHaveAttribute("title");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");

    await act(async () => {
      now = 26;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("a")).toBe(link);
    expect(link).toHaveTextContent("Docs");
    expect(link).not.toHaveAttribute("href");
    expect(link).not.toHaveAttribute("title");
    expect(link).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      now = 426;
      await vi.advanceTimersByTimeAsync(416);
    });
    expect(container.querySelector("a")).toBe(link);
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("title", "Documentation");
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(link).not.toHaveAttribute("tabindex");
  });

  it("keeps a linked image inert until the image reveal has settled", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    let resolveDecode: (() => void) | undefined;
    class MockLinkedImage {
      static readonly instances: MockLinkedImage[] = [];
      complete = false;
      decoding = "auto";
      naturalHeight = 0;
      naturalWidth = 0;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      src = "";
      readonly decode = vi.fn(
        () => new Promise<void>((resolve) => {
          resolveDecode = resolve;
        }),
      );

      constructor() {
        MockLinkedImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockLinkedImage);

    const { container } = render(
      <Smoothstream>
        {"[![Diagram](/diagram.svg)](https://example.com)"}
      </Smoothstream>,
    );
    await act(async () => {
      now = 20;
      await vi.advanceTimersByTimeAsync(32);
    });

    const link = container.querySelector("a");
    expect(link).toContainElement(screen.getByAltText("Diagram"));
    expect(link).not.toHaveAttribute("href");

    const request = MockLinkedImage.instances[0];
    if (!request) {
      throw new Error("Expected the linked image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 640;
    request.naturalHeight = 360;
    await act(async () => {
      now = 100;
      request.onload?.();
      resolveDecode?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      now = 420;
      await vi.advanceTimersByTimeAsync(320);
    });
    expect(container.querySelector("a")).toBe(link);
    expect(link).not.toHaveAttribute("href");

    await act(async () => {
      now = 501;
      await vi.advanceTimersByTimeAsync(81);
    });
    expect(container.querySelector("a")).toBe(link);
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("reveals prose without exposing an incomplete link destination", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const leading =
      "This ordinary introduction is long enough to reveal before the link begins. ";
    const incomplete = `${leading}Read [the docs](`;
    const { container, rerender } = render(
      <Smoothstream receiving>{incomplete}</Smoothstream>,
    );
    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });

    expect(container).toHaveTextContent("ordinary introduction");
    expect(container).not.toHaveTextContent("[the docs](");
    expect(container.querySelector("a")).not.toBeInTheDocument();

    now = 1_100;
    rerender(
      <Smoothstream
        receiving
      >
        {`${incomplete}https://example.com) followed by enough stable prose to clear the lookahead window.`}
      </Smoothstream>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => {
      now = 2_000;
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector("a")).toHaveTextContent("the docs");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(container).not.toHaveTextContent("[the docs](");
  });

  it("waits for a late reference definition before rendering its link", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const unresolved =
      "This leading prose can reveal while the later [guide][docs] remains unresolved.\n\nA following paragraph must not overtake that reference.\n\n";
    const { container, rerender } = render(
      <Smoothstream receiving>{unresolved}</Smoothstream>,
    );
    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });

    expect(container).toHaveTextContent("This leading prose");
    expect(container).not.toHaveTextContent("[guide][docs]");
    expect(container).not.toHaveTextContent("following paragraph");
    expect(container.querySelector("a")).not.toBeInTheDocument();

    now = 1_100;
    rerender(
      <Smoothstream
        receiving
      >
        {`${unresolved}[docs]: https://example.com/guide\n\n`}
      </Smoothstream>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    await act(async () => {
      now = 2_000;
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector("a")).toHaveTextContent("guide");
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com/guide",
    );
    expect(container).toHaveTextContent("following paragraph");
    expect(container).not.toHaveTextContent("[guide][docs]");
  });

  it("does not leak unmatched emphasis into a later heading", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const source = "**Literal note\n\n# Clean heading\n\n";
    const { container } = render(
      <Smoothstream receiving>{source}</Smoothstream>,
    );
    await act(async () => {
      now = 10_000;
      await vi.runAllTimersAsync();
    });

    expect(container.querySelector("h1")).toHaveTextContent("Clean heading");
    expect(container.querySelector("h1")).not.toHaveTextContent("**");
  });

  it("keeps settled character nodes mounted until their block completes", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>{"abcdefghij"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });
    const firstCharacter = container.querySelector(
      '[data-smoothstream-unit="text:0:1"]',
    );
    expect(firstCharacter).not.toBeNull();

    await act(async () => {
      now = 410;
      await vi.advanceTimersByTimeAsync(416);
    });
    const settledFirstCharacter = container.querySelector(
      '[data-smoothstream-unit="text:0:1"]',
    );
    expect(settledFirstCharacter).toBe(firstCharacter);
    expect(settledFirstCharacter).toHaveAttribute(
      "data-smoothstream-state",
      "settled",
    );

    await act(async () => {
      now = 1_000;
      await vi.runAllTimersAsync();
    });
    expect(container.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(
      0,
    );
    expect(container.querySelector("p")).toHaveTextContent("abcdefghij");
  });

  it("compacts one completed block while a later block keeps revealing", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>{"One\n\nabcdefghijklmnopqrst"}</Smoothstream>,
    );
    await act(async () => {
      now = 415;
      await vi.advanceTimersByTimeAsync(416);
    });

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("One");
    expect(
      paragraphs[0]?.querySelectorAll("[data-smoothstream-unit]"),
    ).toHaveLength(0);
    expect(
      paragraphs[1]?.querySelectorAll("[data-smoothstream-unit]").length,
    ).toBeGreaterThan(0);
  });

  it("compacts one list item while a later item keeps revealing", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>
        {"- One\n- abcdefghijklmnopqrstuvwxyz"}
      </Smoothstream>,
    );
    await act(async () => {
      now = 415;
      await vi.advanceTimersByTimeAsync(416);
    });

    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("One");
    expect(
      items[0]?.querySelectorAll("[data-smoothstream-unit]"),
    ).toHaveLength(0);
    expect(
      items[1]?.querySelectorAll("[data-smoothstream-unit]").length,
    ).toBeGreaterThan(0);
  });

  it("reveals headings and list items as characters", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream>{"# Hi\n\n- One"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(container.querySelector("h1")).toHaveTextContent("H");
    expect(container.querySelector("h1")).not.toHaveAttribute(
      "data-smoothstream-unit",
    );
    expect(container.querySelector("li")).not.toBeInTheDocument();

    await act(async () => {
      now = 170;
      await vi.advanceTimersByTimeAsync(176);
    });
    expect(container.querySelector("li")).toHaveTextContent("O");
    expect(container.querySelector("li [data-smoothstream-unit]"))
      .toHaveAttribute(
      "data-smoothstream-unit",
      "text:8:9",
    );
    expect(container.querySelector("li")).toHaveAttribute(
      "data-smoothstream-marker",
      "active",
    );

    await act(async () => {
      now = 571;
      await vi.advanceTimersByTimeAsync(416);
    });
    expect(container.querySelector("li")).not.toHaveAttribute(
      "data-smoothstream-marker",
    );
  });

  it("reserves the complete buffered word while revealing characters", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream
        interval={5}
        reducedMotion="never"
      >
        {"Wideword"}
      </Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    const character = container.querySelector("[data-smoothstream-unit]");
    expect(character).toHaveTextContent("W");
    expect(character).toHaveAttribute(
      "data-smoothstream-remainder",
      "ideword",
    );
    expect(character?.parentElement?.tagName).toBe("P");
    expect(container.querySelector("[data-smoothstream-word]"))
      .not.toBeInTheDocument();
  });

  it("does not expose a complete inline-code background to reserve its word", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream
        interval={5}
        reducedMotion="never"
      >
        {"`Wideword`"}
      </Smoothstream>,
    );
    await act(async () => {
      now = 11;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(container.querySelector("code")).toHaveTextContent("W");
    expect(container.querySelector("code [data-smoothstream-remainder]"))
      .not.toBeInTheDocument();
  });

  it("reveals complete words as individual presentation units", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container } = render(
      <Smoothstream
        interval={5}
        reducedMotion="never"
        reveal="word"
      >
        {"One two"}
      </Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    expect(container.querySelector("p")).toHaveTextContent("One");
    expect(container.querySelectorAll("[data-smoothstream-word]")).toHaveLength(
      1,
    );
    expect(container.querySelector("[data-smoothstream-word]")).not
      .toHaveAttribute("data-smoothstream-remainder");

    await act(async () => {
      now = 16;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(container.querySelector("p")).toHaveTextContent("One two");
    expect(container.querySelectorAll("[data-smoothstream-word]")).toHaveLength(
      2,
    );
  });

  it("reveals stable list items without waiting for the final item", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container, rerender } = render(
      <Smoothstream receiving>{"- First\n- Second"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    const firstItem = container.querySelector("li");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(firstItem).toHaveTextContent("F");
    expect(container).not.toHaveTextContent("Second");

    now = 10;
    rerender(
      <Smoothstream
        receiving
      >
        {"- First\n- Second\n- Third"}
      </Smoothstream>,
    );
    expect(container.querySelector("li")).toBe(firstItem);
    expect(container.querySelectorAll("li")).toHaveLength(1);

    await act(async () => {
      now = 120;
      await vi.advanceTimersByTimeAsync(128);
    });
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("li")[1]).toHaveTextContent("S");
    expect(container).not.toHaveTextContent("Third");
  });

  it("resumes character animation progress after loose-list reparenting", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const getAnimations = vi.fn(() => []);
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: getAnimations,
    });

    const tight =
      "- First item remains open long enough to reveal before a structural update arrives from the stream";
    const loose = `${tight}.\n\n  A second paragraph makes the list loose.`;
    const { container, rerender } = render(
      <Smoothstream duration={400} receiving>{tight}</Smoothstream>,
    );
    await act(async () => {
      now = 200;
      await vi.advanceTimersByTimeAsync(208);
    });

    const originalCharacter = container.querySelector<HTMLElement>(
      '[data-smoothstream-kind="text"]',
    );
    expect(originalCharacter).not.toBeNull();
    const originalDelay = originalCharacter?.style.getPropertyValue(
      "--smoothstream-animation-delay",
    );

    await act(async () => {
      now = 216;
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(
      originalCharacter?.style.getPropertyValue(
        "--smoothstream-animation-delay",
      ),
    ).toBe(originalDelay);

    now = 300;
    rerender(
      <Smoothstream duration={400} receiving>{loose}</Smoothstream>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });

    const reparentedCharacter = container.querySelector<HTMLElement>(
      '[data-smoothstream-kind="text"]',
    );
    expect(container.querySelector("ul > li > p")).toBeInTheDocument();
    expect(reparentedCharacter).not.toBe(originalCharacter);

    const startAt = Number(
      reparentedCharacter?.dataset.smoothstreamAnimationStart,
    );
    expect(
      reparentedCharacter?.style.getPropertyValue(
        "--smoothstream-animation-delay",
      ),
    ).toBe(`${-(now - startAt)}ms`);
    expect(now - startAt).toBeGreaterThan(0);
    expect(getAnimations).not.toHaveBeenCalled();
  });

  it("reveals each native task checkbox with its first label character", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(now), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );

    const { container, rerender } = render(
      <Smoothstream receiving>{"- [ ] First\n- [x] Second"}</Smoothstream>,
    );
    await act(async () => {
      now = 1;
      await vi.advanceTimersByTimeAsync(16);
    });

    const firstInput = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(firstInput).toBeDisabled();
    expect(firstInput).not.toBeChecked();
    expect(firstInput).toHaveAttribute("data-smoothstream-task", "active");
    expect(container).not.toHaveTextContent("Second");

    now = 10;
    rerender(
      <Smoothstream
        receiving
      >
        {"- [ ] First\n- [x] Second\n- [ ] Third"}
      </Smoothstream>,
    );
    expect(container.querySelector('input[type="checkbox"]')).toBe(firstInput);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);

    await act(async () => {
      now = 120;
      await vi.advanceTimersByTimeAsync(128);
    });
    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toBe(firstInput);
    expect(inputs[1]).toBeChecked();
    expect(inputs[1]).toHaveAttribute("data-smoothstream-task", "active");
    expect(container).not.toHaveTextContent("Third");

    await act(async () => {
      now = 600;
      await vi.advanceTimersByTimeAsync(480);
    });
    expect(inputs[1]).not.toHaveAttribute("data-smoothstream-task");
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });
});
