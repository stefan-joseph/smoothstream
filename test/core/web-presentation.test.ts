import { describe, expect, it } from "vitest";
import {
  resolveCodeHighlight,
  StreamingSession,
  type ImageReadiness,
  type MarkdownReveal,
  type ScheduledUnit,
  type StreamingInputSnapshot,
} from "@smoothstream/core";
import {
  createWebPresentation,
  type WebElementNode,
  type WebPresentationState,
  type WebRenderNode,
} from "@smoothstream/core/web";

class ManualClock {
  constructor(public time = 100) {}

  now(): number {
    return this.time;
  }
}

interface WebFixture {
  readonly input: StreamingInputSnapshot;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
}

interface ProjectionOptions {
  readonly codeHighlighterEnabled?: boolean;
  readonly codeHighlights?: WebPresentationState["codeHighlights"];
  readonly compactedBlockIds?: ReadonlySet<string>;
  readonly compactedUnitIds?: WebPresentationState["compactedUnitIds"];
  readonly confirmedBlockIds?: ReadonlySet<string>;
  readonly images?: ReadonlyMap<string, ImageReadiness>;
  readonly immediate?: boolean;
  readonly now?: number;
  readonly schedules?: ReadonlyMap<string, ScheduledUnit>;
  readonly showLanguageLabels?: boolean;
}

const fixture = (
  source: string,
  reveal: MarkdownReveal = "character",
  inputOpen = false,
): WebFixture => {
  const session = new StreamingSession(new ManualClock(), {
    duration: 100,
    interval: 10,
  });
  const input = session.prepareInput(source, inputOpen, reveal);
  return { input, schedules: session.schedule(input).schedules };
};

const project = (
  value: WebFixture,
  options: ProjectionOptions = {},
): ReadonlyArray<WebRenderNode> => createWebPresentation({
  codeHighlighterEnabled: options.codeHighlighterEnabled ?? false,
  codeHighlights: options.codeHighlights ?? new Map(),
  compactedBlockIds: options.compactedBlockIds ?? new Set(),
  compactedUnitIds: options.compactedUnitIds ?? new Set(),
  confirmedBlockIds: options.confirmedBlockIds ?? value.input.plan.confirmedBlockIds,
  images: options.images ?? new Map(),
  immediate: options.immediate ?? false,
  now: options.now ?? 100,
  reveal: value.input.reveal,
  schedules: options.schedules ?? value.schedules,
  showLanguageLabels: options.showLanguageLabels ?? true,
  tree: value.input.plan.tree,
  units: value.input.plan.units,
});

const elements = (
  nodes: ReadonlyArray<WebRenderNode>,
): ReadonlyArray<WebElementNode> => nodes.flatMap((node) =>
  node.type === "element" ? [node, ...elements(node.children)] : []
);

const textContent = (node: WebRenderNode): string =>
  node.type === "text"
    ? node.value
    : node.children.map(textContent).join("");

const content = (nodes: ReadonlyArray<WebRenderNode>): string =>
  nodes.map(textContent).join("");

const elementsWith = (
  nodes: ReadonlyArray<WebRenderNode>,
  property: string,
  value?: unknown,
): ReadonlyArray<WebElementNode> => elements(nodes).filter((node) =>
  value === undefined
    ? property in node.properties
    : node.properties[property] === value
);

const firstElement = (
  nodes: ReadonlyArray<WebRenderNode>,
  tagName: string,
): WebElementNode | undefined => elements(nodes).find(
  (node) => node.tagName === tagName,
);

const allKeys = (nodes: ReadonlyArray<WebRenderNode>): ReadonlyArray<string> =>
  nodes.flatMap((node): ReadonlyArray<string> => [
    node.key,
    ...(node.type === "element" ? allKeys(node.children) : []),
  ]);

const scheduleAllTogether = (
  value: WebFixture,
  startAt = 100,
): ReadonlyMap<string, ScheduledUnit> => new Map(
  value.input.plan.units.map((unit) => [unit.id, {
    ...unit,
    duration: 100,
    endAt: startAt + 100,
    startAt,
  }]),
);

describe("web presentation model", () => {
  it("creates keyed static HTML structure without an adapter runtime", () => {
    const clock = new ManualClock(0);
    const session = new StreamingSession(clock, {
      duration: 1_000,
      interval: 3,
    });
    const source = [
      "```ts",
      "const ready = true;",
      "```",
      "",
      "![Preview](/preview.png)",
      "",
      "| State | Value |",
      "| --- | --- |",
      "| Ready | Yes |",
    ].join("\n");
    const input = session.prepareInput(source, false);
    session.commitInput(input);
    const playback = session.immediate(input);
    const presentation = session.present(input, playback);

    const nodes = createWebPresentation({
      codeHighlighterEnabled: true,
      codeHighlights: new Map(),
      compactedBlockIds: presentation.compactedBlockIds,
      compactedUnitIds: presentation.compactedUnitIds,
      confirmedBlockIds: input.plan.confirmedBlockIds,
      images: new Map(),
      immediate: true,
      now: presentation.now,
      reveal: input.reveal,
      schedules: presentation.schedules,
      tree: input.plan.tree,
      units: input.plan.units,
    });
    const rendered = elements(nodes);
    const codeBlock = rendered.find((node) =>
      node.properties["data-smoothstream-code-block"] === true
    );
    const copyButton = rendered.find((node) =>
      node.properties["data-smoothstream-code-copy"] === true
    );
    const image = rendered.find((node) => node.tagName === "img");
    const keys = allKeys(nodes);

    expect(keys.every((key) => key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(codeBlock?.tagName).toBe("pre");
    expect(copyButton?.properties.disabled).toBeUndefined();
    expect(image?.properties.src).toBe("/preview.png");
    expect(image?.properties["data-smoothstream-image"]).toBeUndefined();
    expect(rendered.some((node) =>
      node.properties["data-smoothstream-table-shell"] === true
    )).toBe(true);
  });

  it("projects character units through pending, active, settled, and compacted phases", () => {
    const value = fixture("AB");
    const [firstUnit] = value.input.plan.units;
    expect(firstUnit).toBeDefined();
    if (!firstUnit) return;

    const pending = project(value, { now: 99 });
    expect(content(pending)).toBe("");

    const active = project(value, { now: 100 });
    const activeUnit = elementsWith(
      active,
      "data-smoothstream-unit",
      firstUnit.id,
    )[0];
    expect(activeUnit?.properties["data-smoothstream-kind"]).toBe("text");
    expect(activeUnit?.properties["data-smoothstream-animation-start"]).toBe(
      100,
    );

    const settled = project(value, { now: 200 });
    const settledUnit = elementsWith(
      settled,
      "data-smoothstream-unit",
      firstUnit.id,
    )[0];
    expect(settledUnit?.key).toBe(activeUnit?.key);
    expect(settledUnit?.properties["data-smoothstream-state"]).toBe("settled");
    expect(firstElement(settled, "p")?.key).toBe(firstElement(active, "p")?.key);

    const allUnitIds = new Set(value.input.plan.units.map((unit) => unit.id));
    const allBlockIds = new Set(value.input.plan.units.map((unit) => unit.blockId));
    const compacted = project(value, {
      compactedBlockIds: allBlockIds,
      compactedUnitIds: allUnitIds,
      now: 1_000,
    });
    expect(content(compacted)).toBe("AB");
    expect(elementsWith(compacted, "data-smoothstream-unit")).toHaveLength(0);
    expect(firstElement(compacted, "p")?.key).toBe(firstElement(active, "p")?.key);
  });

  it("groups character schedules into whole-word presentation units in word mode", () => {
    const value = fixture("Alpha beta.", "word");

    const firstWord = project(value, { now: 100 });
    const firstWordUnits = elementsWith(
      firstWord,
      "data-smoothstream-word",
      true,
    );
    expect(firstWordUnits).toHaveLength(1);
    expect(textContent(firstWordUnits[0] as WebRenderNode)).toBe("Alpha");

    const bothWords = project(value, { now: 150 });
    const wordUnits = elementsWith(
      bothWords,
      "data-smoothstream-word",
      true,
    );
    expect(wordUnits.map((node) => textContent(node))).toEqual([
      "Alpha",
      "beta.",
    ]);
    expect(elementsWith(bothWords, "data-smoothstream-kind", "text"))
      .toHaveLength(2);
  });

  it("enhances plain code without replacing the code block, toolbar, or copy control", () => {
    const value = fixture("```ts\nconst ready = true;\n```");
    const request = value.input.codeBlocks[0];
    expect(request).toBeDefined();
    if (!request) return;

    const compactedBlockIds = new Set([`block:${request.blockStart}`]);
    const plain = project(value, {
      codeHighlighterEnabled: true,
      compactedBlockIds,
      now: 10_000,
    });
    const plainPre = firstElement(plain, "pre");
    const plainToolbar = elementsWith(
      plain,
      "data-smoothstream-code-toolbar",
      true,
    )[0];
    const plainCopy = elementsWith(
      plain,
      "data-smoothstream-code-copy",
      true,
    )[0];
    expect(plainPre).toBeDefined();
    expect(plainToolbar).toBeDefined();
    expect(plainCopy?.properties.disabled).toBeUndefined();
    expect(elementsWith(plain, "data-smoothstream-code-token"))
      .toHaveLength(0);

    const highlight = resolveCodeHighlight(request, {
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
    const highlighted = project(value, {
      codeHighlighterEnabled: true,
      codeHighlights: new Map([[request.blockStart, highlight]]),
      compactedBlockIds,
      now: 10_000,
    });
    const highlightedPre = firstElement(highlighted, "pre");
    const highlightedToolbar = elementsWith(
      highlighted,
      "data-smoothstream-code-toolbar",
      true,
    )[0];
    const highlightedCopy = elementsWith(
      highlighted,
      "data-smoothstream-code-copy",
      true,
    )[0];
    const token = elementsWith(highlighted, "data-smoothstream-code-token")[0];

    expect(highlightedPre?.key).toBe(plainPre?.key);
    expect(highlightedToolbar?.key).toBe(plainToolbar?.key);
    expect(highlightedCopy?.key).toBe(plainCopy?.key);
    expect(highlightedPre?.properties["data-smoothstream-code-label"])
      .toBe("TypeScript");
    expect(highlightedPre?.properties["data-smoothstream-code-theme"])
      .toBe(true);
    expect(token?.properties.style).toEqual({ color: "#c00000" });
    expect(content(highlighted)).toContain("const ready = true;");
  });

  it("fades the enhanced code shell once with its complete language title", () => {
    const value = fixture("```ts\nconst ready = true;\n```");
    const request = value.input.codeBlocks[0];
    const firstLine = value.input.plan.units.find(
      (unit) => unit.kind === "code-line",
    );
    expect(request).toBeDefined();
    expect(firstLine).toBeDefined();
    if (!request || !firstLine) return;
    const schedule = value.schedules.get(firstLine.id);
    expect(schedule).toBeDefined();
    if (!schedule) return;
    const highlight = resolveCodeHighlight(request, {
      languageLabel: "TypeScript",
      lines: request.lines.map((line) => ({ tokens: [{ content: line }] })),
    });
    const projectionOptions = {
      codeHighlighterEnabled: true,
      codeHighlights: new Map([[request.blockStart, highlight]]),
    };

    const active = project(value, {
      ...projectionOptions,
      now: schedule.startAt,
    });
    const activePre = firstElement(active, "pre");
    const language = elementsWith(
      active,
      "data-smoothstream-code-language",
      true,
    )[0];

    expect(activePre?.properties["data-smoothstream-code-enter"])
      .toBe("active");
    expect(activePre?.properties["data-smoothstream-code-single-line"])
      .toBe(true);
    expect(activePre?.properties["data-smoothstream-animation-start"])
      .toBe(schedule.startAt);
    expect(activePre?.properties["data-smoothstream-animation-duration"])
      .toBe(schedule.duration);
    expect(activePre?.properties.style).toMatchObject({
      "--smoothstream-animation-delay": "0ms",
      "--smoothstream-duration": `${schedule.duration}ms`,
    });
    expect(language && textContent(language)).toBe("TypeScript");
    expect(language && elementsWith([language], "data-smoothstream-unit"))
      .toHaveLength(0);

    const settled = project(value, {
      ...projectionOptions,
      now: schedule.endAt,
    });
    const settledPre = firstElement(settled, "pre");
    expect(settledPre?.key).toBe(activePre?.key);
    expect(settledPre?.properties["data-smoothstream-code-enter"])
      .toBeUndefined();

    const immediate = project(value, {
      ...projectionOptions,
      immediate: true,
      now: schedule.startAt,
    });
    expect(firstElement(immediate, "pre")?.properties[
      "data-smoothstream-code-enter"
    ]).toBeUndefined();
  });

  it("mounts copy with canonical code only after block confirmation", () => {
    const open = fixture("```ts\nfirst();\nsecond();\n", "character", true);
    const pending = project(open, {
      codeHighlighterEnabled: true,
      now: 10_000,
    });
    const pendingPre = firstElement(pending, "pre");
    const pendingCopy = elementsWith(
      pending,
      "data-smoothstream-code-copy",
      true,
    )[0];
    const pendingCopySlot = elementsWith(
      pending,
      "data-smoothstream-code-copy-slot",
      true,
    )[0];

    expect(pendingPre?.codeCopyValue).toBeUndefined();
    expect(pendingCopy).toBeUndefined();
    expect(pendingCopySlot).toBeDefined();

    const complete = fixture(
      "```ts\nfirst();\nsecond();\n```",
      "character",
      true,
    );
    const ready = project(complete, {
      codeHighlighterEnabled: true,
      now: 100,
    });
    const readyPre = firstElement(ready, "pre");
    const readyCode = firstElement(ready, "code");
    const readyCopy = elementsWith(
      ready,
      "data-smoothstream-code-copy",
      true,
    )[0];
    const readyCopySlot = elementsWith(
      ready,
      "data-smoothstream-code-copy-slot",
      true,
    )[0];

    expect(readyCode).toBeDefined();
    if (!readyCode) return;
    expect(textContent(readyCode)).not.toBe(
      "first();\nsecond();\n",
    );
    expect(readyPre?.codeCopyValue).toBe("first();\nsecond();");
    expect(readyPre?.properties["data-smoothstream-code-single-line"])
      .toBeUndefined();
    expect(readyPre?.properties).not.toHaveProperty(
      "data-smoothstream-code-copy-value",
    );
    expect(readyCopySlot?.key).toBe(pendingCopySlot?.key);
    expect(readyCopy).toBeDefined();
    expect(readyCopySlot?.children).toContain(readyCopy);
    expect(readyCopy?.properties.disabled).toBeUndefined();
  });

  it("selects the hidden-language layout before highlighting and suppresses later labels", () => {
    const value = fixture("```ts\nconst ready = true;\n```");
    const request = value.input.codeBlocks[0];
    expect(request).toBeDefined();
    if (!request) return;

    const hiddenBeforeHighlight = project(value, {
      codeHighlighterEnabled: true,
      showLanguageLabels: false,
    });
    const initialPre = firstElement(hiddenBeforeHighlight, "pre");
    expect(initialPre?.properties["data-smoothstream-code-language-hidden"])
      .toBe(true);
    expect(initialPre?.properties["data-smoothstream-code-label"]).toBe("");

    const highlight = resolveCodeHighlight(request, {
      languageLabel: "TypeScript",
      lines: [{ tokens: [{ content: "const ready = true;" }] }],
    });
    const hiddenAfterHighlight = project(value, {
      codeHighlighterEnabled: true,
      codeHighlights: new Map([[request.blockStart, highlight]]),
      showLanguageLabels: false,
    });
    const highlightedPre = firstElement(hiddenAfterHighlight, "pre");
    const language = elementsWith(
      hiddenAfterHighlight,
      "data-smoothstream-code-language",
      true,
    )[0];
    const copy = elementsWith(
      hiddenAfterHighlight,
      "data-smoothstream-code-copy",
      true,
    )[0];

    expect(highlightedPre?.properties["data-smoothstream-code-language-hidden"])
      .toBe(true);
    expect(highlightedPre?.properties["data-smoothstream-code-label"]).toBe("");
    expect(language && textContent(language)).toBe("");
    expect(copy?.properties["aria-label"]).toBe("Copy code");
  });

  it("projects inline images through pending, ready, and failed states without exposing their suffix early", () => {
    const value = fixture("Before ![Icon](/icon.png) after.");
    const imageUnit = value.input.plan.units.find((unit) => unit.kind === "image");
    expect(imageUnit).toBeDefined();
    if (!imageUnit) return;

    const pending = project(value, { now: 10_000 });
    const pendingImage = firstElement(pending, "img");
    expect(pendingImage?.properties["data-smoothstream-image"]).toBe("pending");
    expect(pendingImage?.properties["aria-hidden"]).toBe(true);
    expect(pendingImage?.properties["data-smoothstream-image-standalone"])
      .toBeUndefined();
    expect(content(pending)).toContain("Before");
    expect(content(pending)).not.toContain("after");

    const ready = project(value, {
      images: new Map([[imageUnit.id, {
        height: 24,
        readyAt: 100,
        status: "ready",
        width: 24,
      }]]),
      now: 10_000,
    });
    const readyImage = firstElement(ready, "img");
    expect(readyImage?.key).toBe(pendingImage?.key);
    expect(readyImage?.properties["data-smoothstream-image"]).toBe("ready");
    expect(readyImage?.properties["data-smoothstream-state"]).toBe("settled");
    expect(readyImage?.properties.width).toBe(24);
    expect(readyImage?.properties.height).toBe(24);
    expect(content(ready)).toContain("after.");

    const failed = project(value, {
      images: new Map([[imageUnit.id, {
        readyAt: 100,
        status: "error",
      }]]),
      now: 10_000,
    });
    const failedImage = firstElement(failed, "img");
    expect(failedImage?.key).toBe(pendingImage?.key);
    expect(failedImage?.properties["data-smoothstream-image"]).toBe("error");
    expect(failedImage?.properties.width).toBeUndefined();
    expect(failedImage?.properties.height).toBeUndefined();
    expect(content(failed)).toContain("after.");
  });

  it("marks standalone images and keeps linked images inert until their reveal settles", () => {
    const standalone = fixture("![Diagram](/diagram.svg)");
    const standaloneUnit = standalone.input.plan.units.find(
      (unit) => unit.kind === "image",
    );
    expect(standaloneUnit).toBeDefined();
    if (!standaloneUnit) return;
    const standaloneNodes = project(standalone, {
      images: new Map([[standaloneUnit.id, {
        height: 360,
        readyAt: 100,
        status: "ready",
        width: 640,
      }]]),
      now: 150,
    });
    expect(firstElement(standaloneNodes, "img")?.properties[
      "data-smoothstream-image-standalone"
    ]).toBe(true);

    const linked = fixture(
      "[![Icon](/icon.png)](https://example.com)",
    );
    const linkedImageUnit = linked.input.plan.units.find(
      (unit) => unit.kind === "image",
    );
    expect(linkedImageUnit).toBeDefined();
    if (!linkedImageUnit) return;
    const schedules = scheduleAllTogether(linked);
    const images = new Map<string, ImageReadiness>([[linkedImageUnit.id, {
      height: 24,
      readyAt: 100,
      status: "ready",
      width: 24,
    }]]);

    const active = project(linked, {
      images,
      now: 150,
      schedules,
    });
    const activeLink = firstElement(active, "a");
    expect(activeLink?.properties.href).toBeUndefined();
    expect(activeLink?.properties["aria-disabled"]).toBe(true);
    expect(activeLink?.properties.tabIndex).toBe(-1);

    const settled = project(linked, {
      images,
      now: 200,
      schedules,
    });
    const settledLink = firstElement(settled, "a");
    expect(settledLink?.key).toBe(activeLink?.key);
    expect(settledLink?.properties.href).toBe("https://example.com");
    expect(settledLink?.properties["aria-disabled"]).toBeUndefined();
    expect(settledLink?.properties["data-smoothstream-state"]).toBe("settled");
  });

  it("projects tables through hidden, pending, active, settled, and compacted row states", () => {
    const value = fixture([
      "| Name | Value |",
      "| --- | --- |",
      "| One | First |",
      "| Two | Second |",
    ].join("\n"));
    const rowUnits = value.input.plan.units.filter(
      (unit) => unit.kind === "table-row",
    );
    expect(rowUnits).toHaveLength(3);
    const rowStartByBlock = new Map(
      rowUnits.map((unit, index) => [unit.blockId, 100 + index * 300]),
    );
    const schedules = new Map(value.input.plan.units.map((unit) => {
      const rowStart = rowStartByBlock.get(unit.blockId) ?? 100;
      const startAt = unit.kind === "table-row" ? rowStart : rowStart + 10;
      return [unit.id, {
        ...unit,
        duration: 100,
        endAt: startAt + 100,
        startAt,
      } satisfies ScheduledUnit] as const;
    }));

    const hidden = project(value, { now: 99, schedules });
    expect(firstElement(hidden, "table")).toBeUndefined();
    expect(elementsWith(hidden, "data-smoothstream-table-shell"))
      .toHaveLength(0);

    const firstActive = project(value, { now: 100, schedules });
    const activeRows = elements(firstActive).filter(
      (node) => node.tagName === "tr",
    );
    expect(activeRows).toHaveLength(3);
    expect(activeRows[0]?.properties["data-smoothstream-kind"])
      .toBe("table-row");
    expect(activeRows[0]?.properties["data-smoothstream-state"])
      .toBeUndefined();
    expect(activeRows.slice(1).every((row) =>
      row.properties["data-smoothstream-state"] === "pending"
    )).toBe(true);

    const firstSettled = project(value, { now: 200, schedules });
    const settledRows = elements(firstSettled).filter(
      (node) => node.tagName === "tr",
    );
    expect(settledRows[0]?.key).toBe(activeRows[0]?.key);
    expect(settledRows[0]?.properties["data-smoothstream-state"])
      .toBe("settled");

    const secondActive = project(value, { now: 400, schedules });
    const secondRows = elements(secondActive).filter(
      (node) => node.tagName === "tr",
    );
    expect(secondRows[1]?.key).toBe(activeRows[1]?.key);
    expect(secondRows[1]?.properties["data-smoothstream-kind"])
      .toBe("table-row");
    expect(secondRows[1]?.properties["data-smoothstream-state"])
      .toBeUndefined();
    expect(secondRows[2]?.properties["data-smoothstream-state"])
      .toBe("pending");

    const allUnitIds = new Set(value.input.plan.units.map((unit) => unit.id));
    const allBlockIds = new Set(value.input.plan.units.map((unit) => unit.blockId));
    const compacted = project(value, {
      compactedBlockIds: allBlockIds,
      compactedUnitIds: allUnitIds,
      now: 1_000,
      schedules,
    });
    expect(elementsWith(compacted, "data-smoothstream-unit")).toHaveLength(0);
    expect(content(compacted)).toContain("One");
    expect(content(compacted)).toContain("Second");
    expect(elementsWith(compacted, "data-smoothstream-table-shell", true))
      .toHaveLength(1);
  });

  it("keeps all surviving record keys stable and unique across updates", () => {
    const value = fixture("Before ![Icon](/icon.png) after.");
    const imageUnit = value.input.plan.units.find((unit) => unit.kind === "image");
    expect(imageUnit).toBeDefined();
    if (!imageUnit) return;

    const pending = project(value, { now: 10_000 });
    const ready = project(value, {
      images: new Map([[imageUnit.id, {
        height: 24,
        readyAt: 100,
        status: "ready",
        width: 24,
      }]]),
      now: 10_000,
    });
    const pendingKeys = allKeys(pending);
    const readyKeys = allKeys(ready);
    const pendingKeySet = new Set(pendingKeys);
    const readyKeySet = new Set(readyKeys);

    expect(pendingKeySet.size).toBe(pendingKeys.length);
    expect(readyKeySet.size).toBe(readyKeys.length);
    expect(firstElement(ready, "p")?.key).toBe(firstElement(pending, "p")?.key);
    expect(firstElement(ready, "img")?.key).toBe(
      firstElement(pending, "img")?.key,
    );
    expect([...pendingKeySet].every((key) =>
      readyKeySet.has(key) || key.startsWith("unit:")
    )).toBe(true);
  });
});
