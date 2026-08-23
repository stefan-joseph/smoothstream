// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSmoothstream } from "@smoothstream/dom";
import type {
  CodeHighlighter,
  CodeHighlightResult,
} from "@smoothstream/core";

interface FrameHarness {
  flush(time?: number): void;
  now(value: number): void;
  pending(): number;
}

const installFrameHarness = (): FrameHarness => {
  let currentTime = 0;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window.performance, "now").mockImplementation(() => currentTime);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  return {
    flush(time = currentTime) {
      currentTime = time;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(currentTime));
    },
    now(value) {
      currentTime = value;
    },
    pending: () => frames.size,
  };
};

const matchMedia = (matches = false): typeof window.matchMedia => () => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(),
  matches,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn(),
});

const liveMatchMedia = (
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
      if (listener) listeners.add(listener);
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
      if (listener) listeners.delete(listener);
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

describe("createSmoothstream", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("matchMedia", matchMedia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders semantic Markdown immediately without React", () => {
    const frames = installFrameHarness();
    const container = document.createElement("section");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      motion: "none",
    });
    controller.update([
        "# DOM adapter",
        "",
        "A **strong** [link](https://example.com).",
        "",
        "- First",
        "- Second",
        "",
        "| Name | State |",
        "| --- | --- |",
        "| Core | Ready |",
        "",
        "```js",
        "const ready = true;",
        "```",
      ].join("\n"));

    frames.flush();

    expect(controller.element.querySelector("h1")?.textContent).toBe("DOM adapter");
    expect(controller.element.querySelector("strong")?.textContent).toBe("strong");
    expect(controller.element.querySelector("a")).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(controller.element.querySelectorAll("li")).toHaveLength(2);
    expect(controller.element.querySelector("table")?.textContent).toContain("Core");
    expect(controller.element.querySelector("code")?.textContent).toContain(
      "const ready = true;",
    );
    expect(controller.element.querySelector("code span")).toBeNull();
    expect(controller.element.querySelector("[data-smoothstream-unit]")).toBeNull();
    expect(document.querySelector("[data-smoothstream-announcer]")).toHaveTextContent(
      "Content ready.",
    );

    controller.destroy();
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector("[data-smoothstream-announcer]")).toBeNull();
  });

  it("coalesces pending updates and enforces append-only input", () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      receiving: true,
      motion: "none",
    });

    controller.update("First", { receiving: true });
    controller.update("First response", { receiving: true });
    controller.update("First response", { receiving: false });
    expect(frames.pending()).toBe(1);
    frames.flush();

    expect(controller.element).toHaveTextContent("First response");
    expect(() => controller.update("Replacement")).toThrow(/append-only/u);
    controller.destroy();
  });

  it("preserves existing unit nodes while later characters enter", () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      duration: 100,
      interval: 10,
      motion: "animate",
    });
    controller.update("Smooth reveal.");

    frames.flush(0);
    const firstUnit = controller.element.querySelector<HTMLElement>(
      "[data-smoothstream-unit]",
    );
    expect(firstUnit).not.toBeNull();
    const firstDelay = firstUnit?.style.getPropertyValue(
      "--smoothstream-animation-delay",
    );

    frames.flush(30);
    expect(controller.element.querySelector("[data-smoothstream-unit]"))
      .toBe(firstUnit);
    expect(firstUnit?.style.getPropertyValue("--smoothstream-animation-delay"))
      .toBe(firstDelay);
    expect(controller.element.textContent?.length).toBeGreaterThan(1);

    frames.flush(1_000);
    expect(controller.element).toHaveTextContent("Smooth reveal.");
    expect(controller.element.querySelector("[data-smoothstream-unit]")).toBeNull();
    controller.destroy();
  });

  it("atomically compacts animated text without replacing its semantic container", () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      duration: 100,
      interval: 1,
      motion: "animate",
    });
    controller.update("- Parent item\n  - Nested ideas retain their hierarchy.");

    frames.flush(0);
    frames.flush(60);
    const nestedItem = controller.element.querySelector<HTMLLIElement>("li li");
    expect(nestedItem).not.toBeNull();
    expect(nestedItem?.querySelectorAll("span").length).toBeGreaterThan(1);
    const replaceChildren = vi.spyOn(nestedItem as HTMLLIElement, "replaceChildren");

    frames.flush(1_000);

    expect(controller.element.querySelector("li li")).toBe(nestedItem);
    expect(nestedItem).toHaveTextContent("Nested ideas retain their hierarchy.");
    expect(nestedItem?.querySelector("span")).toBeNull();
    expect(replaceChildren).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it("keeps an animated nested list attached while its parent text compacts", () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      duration: 100,
      interval: 5,
      motion: "animate",
    });
    controller.update("- Parent text\n  - Nested text continues animating");

    frames.flush(0);
    let nestedList: HTMLUListElement | null = null;
    let parentItem: HTMLLIElement | null = null;
    let insertBefore: ReturnType<typeof vi.spyOn> | null = null;
    let observedParentCompaction = false;
    for (let now = 20; now <= 1_000; now += 20) {
      frames.flush(now);
      if (!nestedList) {
        nestedList = controller.element.querySelector<HTMLUListElement>("li > ul");
        parentItem = nestedList?.parentElement as HTMLLIElement | null;
        if (parentItem) insertBefore = vi.spyOn(parentItem, "insertBefore");
      }
      if (!nestedList || !parentItem) continue;
      const directUnits = [...parentItem.children].filter((child) =>
        child.hasAttribute("data-smoothstream-unit")
      );
      if (
        directUnits.length === 0 &&
        nestedList.querySelector("[data-smoothstream-unit]") !== null
      ) {
        observedParentCompaction = true;
        break;
      }
    }

    expect(observedParentCompaction).toBe(true);
    expect(controller.element.querySelector("li > ul")).toBe(nestedList);
    expect(
      insertBefore?.mock.calls.some((call: unknown[]) => call[0] === nestedList),
    ).toBe(false);
    controller.destroy();
  });

  it("waits for highlighted code and renders the enhanced code block", async () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    let resolveHighlight: ((result: CodeHighlightResult) => void) | undefined;
    const highlight = vi.fn(() => new Promise<CodeHighlightResult>((resolve) => {
      resolveHighlight = resolve;
    }));
    const highlighter: CodeHighlighter = {
      highlight,
      name: "test-highlighter",
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const controller = createSmoothstream(container, {
      codeHighlighter: highlighter,
      motion: "none",
    });
    controller.update("```ts\nconst ready = true;\n```");

    frames.flush();
    expect(highlight).toHaveBeenCalledOnce();
    expect(controller.element.querySelector("pre")).toBeNull();

    resolveHighlight?.({
      languageLabel: "TypeScript",
      lines: [{
        tokens: [
          { content: "const", style: { color: "#c00000" } },
          { content: " ready = true;" },
        ],
      }],
      palette: {
        backgroundColor: "#f5f5f5",
        color: "#202020",
      },
    });

    await vi.waitFor(() => {
      expect(controller.element.querySelector("pre[data-smoothstream-code-block]"))
        .not.toBeNull();
    });
    const pre = controller.element.querySelector<HTMLPreElement>(
      "pre[data-smoothstream-code-block]",
    );
    const button = pre?.querySelector<HTMLButtonElement>(
      "button[data-smoothstream-code-copy]",
    );
    expect(pre).toHaveAttribute("data-smoothstream-code-label", "TypeScript");
    expect(pre?.style.getPropertyValue("--smoothstream-shiki-background"))
      .toBe("#f5f5f5");
    expect(pre?.querySelector("[data-smoothstream-code-language]"))
      .toHaveTextContent("TypeScript");
    expect(pre?.querySelector("[data-smoothstream-code-token]"))
      .toHaveStyle({ color: "rgb(192, 0, 0)" });
    expect(button).toHaveAttribute("data-smoothstream-ready", "true");
    expect(button?.querySelector("svg")?.namespaceURI)
      .toBe("http://www.w3.org/2000/svg");

    button?.click();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("const ready = true;\n");
    });
    expect(button).toHaveAttribute("aria-label", "Code copied");
    expect(button?.querySelector("[data-smoothstream-code-icon-swap]"))
      .toHaveAttribute("data-state", "check");
    controller.destroy();
    delete (window.navigator as unknown as Record<string, unknown>).clipboard;
  });

  it("finishes immediately when reduced motion turns on and does not replay later", () => {
    const frames = installFrameHarness();
    const preference = liveMatchMedia(false);
    vi.stubGlobal("matchMedia", preference.matchMedia);
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      duration: 100,
      interval: 10,
    });
    controller.update("abcdefghij");

    frames.flush(0);
    expect(controller.element).toHaveAttribute("data-smoothstream-motion", "animate");
    expect(controller.element.querySelectorAll("[data-smoothstream-unit]").length)
      .toBeGreaterThan(0);

    preference.dispatch(true);
    expect(controller.element).toHaveTextContent("abcdefghij");
    expect(controller.element).toHaveAttribute("data-smoothstream-motion", "none");
    expect(controller.element.querySelector("[data-smoothstream-unit]")).toBeNull();

    preference.dispatch(false);
    expect(controller.element).toHaveAttribute("data-smoothstream-motion", "none");
    expect(controller.element.querySelector("[data-smoothstream-unit]")).toBeNull();
    controller.destroy();
  });

  it("withholds the table until its first row is visible, then retains future rows for sizing", () => {
    const frames = installFrameHarness();
    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      duration: 100,
      interval: 10,
      motion: "animate",
    });
    controller.update([
        "Before table.",
        "",
        "| Name | Description |",
        "| --- | --- |",
        "| One | Short |",
        "| Two | A much longer value |",
      ].join("\n"));

    frames.flush(0);
    expect(controller.element.querySelector("table")).toBeNull();
    let pendingRow: HTMLTableRowElement | null = null;
    let observedAt = 0;
    for (let now = 50; now <= 1_000; now += 50) {
      frames.flush(now);
      observedAt = now;
      pendingRow = controller.element.querySelector<HTMLTableRowElement>(
        'tr[data-smoothstream-state="pending"]',
      );
      if (pendingRow?.textContent?.includes("A much longer value")) break;
    }

    expect(pendingRow).not.toBeNull();
    expect(pendingRow).toHaveTextContent("Two");
    expect(pendingRow).toHaveTextContent("A much longer value");
    expect(pendingRow?.querySelector("[data-smoothstream-unit]")).toBeNull();
    expect(pendingRow).toHaveStyle({ visibility: "collapse" });

    let revealingRow: HTMLTableRowElement | null = null;
    for (let now = observedAt + 25; now <= 1_000; now += 25) {
      frames.flush(now);
      revealingRow = [...controller.element.querySelectorAll<HTMLTableRowElement>("tr")]
        .find((row) =>
          row.dataset.smoothstreamKind === "table-row" &&
          row.textContent?.includes("A much longer value") &&
          row.querySelector('[data-smoothstream-state="pending"]') !== null
        ) ?? null;
      if (revealingRow) break;
    }

    expect(revealingRow).not.toBeNull();
    expect(revealingRow).toHaveTextContent("A much longer value");
    expect(revealingRow?.querySelector('[data-smoothstream-state="pending"]'))
      .not.toBeNull();

    frames.flush(1_000);
    expect(controller.element.querySelectorAll("tr").length).toBeGreaterThanOrEqual(3);
    controller.destroy();
  });

  it("does not treat an image as ready until it has decoded", async () => {
    const frames = installFrameHarness();
    let resolveDecode: (() => void) | undefined;
    class MockImage {
      static readonly instances: MockImage[] = [];
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
        MockImage.instances.push(this);
      }
    }
    vi.stubGlobal("Image", MockImage);

    const container = document.createElement("div");
    document.body.append(container);
    const controller = createSmoothstream(container, {
      motion: "none",
    });
    controller.update("![Diagram](/diagram.svg)\n\nLater content.");
    frames.flush();

    const pendingImage = controller.element.querySelector("img");
    expect(pendingImage).toHaveAttribute("alt", "Diagram");
    expect(pendingImage).toHaveAttribute("data-smoothstream-image", "pending");
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0]?.src).toBe("/diagram.svg");
    expect(controller.element).toHaveTextContent("Later content.");

    const request = MockImage.instances[0];
    if (!request) {
      throw new Error("Expected the image preload request to exist.");
    }
    request.complete = true;
    request.naturalWidth = 640;
    request.naturalHeight = 360;
    request.onload?.();
    request.onload?.();
    await Promise.resolve();

    expect(controller.element.querySelector("img")).toHaveAttribute(
      "data-smoothstream-image",
      "pending",
    );
    expect(request.decode).toHaveBeenCalledOnce();

    resolveDecode?.();
    await vi.waitFor(() => {
      expect(controller.element.querySelector("img")).not.toHaveAttribute(
        "data-smoothstream-image",
        "pending",
      );
    });

    const readyImage = controller.element.querySelector("img");
    expect(readyImage).toHaveAttribute("alt", "Diagram");
    expect(readyImage).not.toHaveAttribute("aria-hidden");
    controller.destroy();
  });
});
