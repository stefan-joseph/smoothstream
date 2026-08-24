import type { Element, Node, Parent, Text } from "hast";
import { describe, expect, it } from "vitest";
import { RevealScheduler } from "../../packages/core/src/scheduler";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";
import { createMarkdownPlan } from "../../packages/core/src/markdown/unitize";

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;
const isText = (node: Node): node is Text => node.type === "text";

const collectElements = (
  node: Node,
  tagName: string,
  result: Element[] = [],
): Element[] => {
  if (isElement(node) && node.tagName === tagName) {
    result.push(node);
  }
  if (isParent(node)) {
    for (const child of node.children) {
      collectElements(child, tagName, result);
    }
  }
  return result;
};

const collectText = (node: Node, result: Text[] = []): Text[] => {
  if (isText(node)) {
    result.push(node);
  }
  if (isParent(node)) {
    for (const child of node.children) {
      collectText(child, result);
    }
  }
  return result;
};

describe("parseMarkdown", () => {
  it("preserves semantic structure and canonical positions", () => {
    const source = "Hello **world**.";
    const tree = parseMarkdown(source);
    const paragraph = tree.children[0];

    expect(paragraph).toMatchObject({
      type: "element",
      tagName: "p",
      position: {
        start: { offset: 0 },
        end: { offset: source.length },
      },
    });
    expect(collectText(tree)).toMatchObject([
      {
        value: "Hello ",
        position: { start: { offset: 0 }, end: { offset: 6 } },
      },
      {
        value: "world",
        position: { start: { offset: 8 }, end: { offset: 13 } },
      },
      {
        value: ".",
        position: { start: { offset: 15 }, end: { offset: 16 } },
      },
    ]);
  });

  it("characterizes escapes, inline code, links, and Unicode positions", () => {
    const source = [
      "Escaped \\*character\\*.",
      "",
      "A [link](https://example.com).",
      "",
      "`inline code`",
      "",
      "👨‍👩‍👧‍👦 café",
    ].join("\n");
    const text = collectText(parseMarkdown(source)).filter((node) =>
      /\S/u.test(node.value),
    );

    expect(text.map((node) => node.value)).toEqual([
      "Escaped *character*.",
      "A ",
      "link",
      ".",
      "inline code",
      "👨‍👩‍👧‍👦 café",
    ]);
    expect(text.every((node) => node.position?.start.offset !== undefined)).toBe(
      true,
    );
  });

  it.each([
    {
      href: "javascript:alert(1)",
      markdown: "[xss](javascript:alert(1))",
      name: "javascript: links",
    },
    {
      href: "JAVASCRIPT:alert(1)",
      markdown: "[xss](JAVASCRIPT:alert(1))",
      name: "uppercase javascript: links",
    },
    {
      href: "vbscript:alert(1)",
      markdown: "[xss](vbscript:alert(1))",
      name: "vbscript: links",
    },
    {
      href: "data:text/html,<script>alert(1)</script>",
      markdown: "[xss](data:text/html,<script>alert(1)</script>)",
      name: "data: links",
    },
    {
      href: "javascript:alert(1)",
      markdown: "<javascript:alert(1)>",
      name: "javascript: autolinks",
    },
    {
      href: "irc://irc.example.com/smoothstream",
      markdown: "[chat](irc://irc.example.com/smoothstream)",
      name: "irc: links",
    },
    {
      href: "ircs://irc.example.com/smoothstream",
      markdown: "[chat](ircs://irc.example.com/smoothstream)",
      name: "ircs: links",
    },
    {
      href: "xmpp:user@example.com",
      markdown: "[chat](xmpp:user@example.com)",
      name: "xmpp: links",
    },
  ])("strips $name from href", ({ href, markdown }) => {
    const links = collectElements(parseMarkdown(markdown), "a");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.properties.href).not.toBe(href);
      expect(link.properties.href).toBeUndefined();
    }
  });

  it.each([
    {
      href: "https://example.com",
      markdown: "[docs](https://example.com)",
      name: "https links",
    },
    {
      href: "http://example.com",
      markdown: "[docs](http://example.com)",
      name: "http links",
    },
    {
      href: "mailto:help@example.com",
      markdown: "[mail](mailto:help@example.com)",
      name: "mailto links",
    },
    {
      href: "tel:+15555550100",
      markdown: "[call](tel:+15555550100)",
      name: "tel links",
    },
    {
      href: "#section",
      markdown: "[fragment](#section)",
      name: "fragment links",
    },
    {
      href: "/docs/guide",
      markdown: "[relative](/docs/guide)",
      name: "root-relative links",
    },
  ])("keeps $name", ({ href, markdown }) => {
    const [link] = collectElements(parseMarkdown(markdown), "a");
    expect(link?.properties.href).toBe(href);
  });

  it("strips javascript: and data: image sources", () => {
    const javascript = collectElements(
      parseMarkdown("![xss](javascript:alert(1))"),
      "img",
    );
    const data = collectElements(
      parseMarkdown("![xss](data:text/html,payload)"),
      "img",
    );

    expect(javascript[0]?.properties.src).toBeUndefined();
    expect(data[0]?.properties.src).toBeUndefined();
  });

  it("keeps http(s) and relative image sources", () => {
    expect(
      collectElements(
        parseMarkdown("![Diagram](https://example.com/diagram.svg)"),
        "img",
      )[0]?.properties.src,
    ).toBe("https://example.com/diagram.svg");
    expect(
      collectElements(parseMarkdown("![Icon](/icon.svg)"), "img")[0]
        ?.properties.src,
    ).toBe("/icon.svg");
  });

  it("preserves GFM table alignment, fenced-code language, and task checkboxes", () => {
    const table = parseMarkdown([
      "| Default | Left | Center | Right |",
      "| --- | :--- | :---: | ---: |",
      "| Plain | Start | Middle | End |",
      "",
    ].join("\n"));
    const headers = collectElements(table, "th");
    expect(headers.map((header) => header.properties.align)).toEqual([
      undefined,
      "left",
      "center",
      "right",
    ]);

    const code = collectElements(
      parseMarkdown("```js\nconst ready = true;\n```"),
      "code",
    )[0];
    expect(code?.properties.className).toEqual(["language-js"]);
    expect(code?.position?.start.offset).toBeDefined();

    const checkbox = collectElements(
      parseMarkdown("- [x] Done\n- [ ] Later\n"),
      "input",
    );
    expect(checkbox).toHaveLength(2);
    expect(checkbox[0]?.properties).toMatchObject({
      checked: true,
      disabled: true,
      type: "checkbox",
    });
    expect(checkbox[1]?.properties).toMatchObject({
      checked: false,
      disabled: true,
      type: "checkbox",
    });
  });

  it("does not turn raw HTML into elements", () => {
    const tree = parseMarkdown("Before <span>content</span> after.");
    expect(collectElements(tree, "span")).toHaveLength(0);
    expect(collectText(tree).map((node) => node.value).join("")).toContain(
      "content",
    );
  });
});

describe("createMarkdownPlan", () => {
  it("creates stable source-backed identities across inline semantics", () => {
    const source = "Hello **deterministic world**.";
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });

    expect(
      plan.units
        .filter((unit) => unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toBe(
      "Hellodeterministicworld.",
    );
    expect(plan.units[0]).toMatchObject({
      id: "text:0:1",
      kind: "text",
      order: 0,
      value: "H",
    });
    expect(plan.units[5]).toMatchObject({
      id: "inline:6:29",
      intervalsAfter: 2,
      kind: "inline",
      order: 5,
      value: "deterministic world",
    });
    expect(plan.units[6]).toMatchObject({
      id: "text:8:9",
      kind: "text",
      order: 6,
      value: "d",
    });
    expect(plan.units.at(-1)).toMatchObject({
      id: "text:29:30",
      order: 24,
      value: ".",
    });
    expect(
      plan.units.every(
        (unit) => unit.delayAfter === undefined && unit.duration === undefined,
      ),
    ).toBe(true);
    expect(plan.confirmedBlockIds.has("block:0")).toBe(true);
  });

  it("treats an extended Unicode grapheme as one reveal unit", () => {
    const family = "👨‍👩‍👧‍👦";
    const source = `${family} e\u0301`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });

    expect(plan.units.map((unit) => unit.value)).toEqual([family, "e\u0301"]);
    expect(plan.units[0]).toMatchObject({
      id: `text:0:${family.length}`,
      sourceRange: { end: family.length, start: 0 },
    });
  });

  it("schedules a complete image atomically and withholds incomplete syntax", () => {
    const source = "Before ![Diagram](/diagram.svg) after.";
    const imageStart = source.indexOf("![");
    const imageEnd = source.indexOf(")", imageStart) + 1;
    const completePlan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const incomplete = "Before ![Diagram](/diagram";
    const incompletePlan = createMarkdownPlan(
      parseMarkdown(incomplete),
      incomplete,
      { inputOpen: true },
    );

    expect(
      completePlan.units.find((unit) => unit.kind === "image"),
    ).toMatchObject({
      id: `image:${imageStart}:${imageEnd}`,
      intervalsAfter: 12,
      kind: "image",
      sourceRange: { end: imageEnd, start: imageStart },
      value: "Diagram",
    });
    expect(incompletePlan.units.some((unit) => unit.kind === "image")).toBe(
      false,
    );
  });

  it("keeps a completed-word prose lead while input remains open and flushes on close", () => {
    const source = `Hello ${"unfinished".repeat(8)}`;
    const openPlan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const finishedPlan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });

    const safeEnd = source.length - 48;
    expect(
      openPlan.units.every((unit) => unit.sourceRange.end <= safeEnd),
    ).toBe(true);
    expect(openPlan.units.at(-1)?.sourceRange.end).toBe(source.indexOf(" "));
    expect(openPlan.units.map((unit) => unit.value).join("")).toBe("Hello");
    expect(finishedPlan.units.map((unit) => unit.value).join("")).toBe(
      source.replaceAll(" ", ""),
    );
  });

  it("commits completed list items while withholding the open final item", () => {
    const source = "- First item is committed\n- Second";
    const secondItemStart = source.indexOf("- Second");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });

    expect(
      plan.units
        .filter((unit) => unit.blockId === "block:0")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("Firstitemiscommitted");
    expect(
      plan.units.filter(
        (unit) => unit.blockId === `block:${secondItemStart}`,
      ),
    ).toHaveLength(0);
    // The item's content is stable, but the open list can still switch between
    // tight and loose HTML, so its wrapper is not structurally confirmed yet.
    expect(plan.confirmedBlockIds.has("block:0")).toBe(false);
    expect(
      plan.confirmedBlockIds.has(`block:${secondItemStart}`),
    ).toBe(false);
  });

  it("paces confirmed list items from the incoming item boundary", () => {
    const source = "- First\n- Second";
    const secondItemStart = source.indexOf("- Second");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });
    scheduler.enqueue(plan.units);

    const firstItemLastUnit = plan.units
      .filter((unit) => unit.blockId === "block:0")
      .at(-1);
    const secondItemFirstUnit = plan.units.find(
      (unit) => unit.blockId === `block:${secondItemStart}`,
    );
    const firstItemLastSchedule = firstItemLastUnit
      ? scheduler.get(firstItemLastUnit.id)
      : undefined;
    const secondItemFirstSchedule = secondItemFirstUnit
      ? scheduler.get(secondItemFirstUnit.id)
      : undefined;

    expect(firstItemLastUnit?.delayAfter).toBeUndefined();
    expect(firstItemLastUnit?.intervalsAfter).toBeUndefined();
    expect(secondItemFirstUnit?.intervalsBefore).toBe(4);
    expect(
      (secondItemFirstSchedule?.startAt ?? 0) -
        (firstItemLastSchedule?.startAt ?? 0),
    ).toBe(20);
  });

  it("paces a confirmed heading relative to the configured interval", () => {
    const source = "# Heading\n\nFollowing prose";
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });
    scheduler.enqueue(plan.units);

    const headingLastUnit = plan.units
      .filter((unit) => unit.blockId === "block:0")
      .at(-1);
    const followingFirstUnit = plan.units.find(
      (unit) => unit.blockId !== "block:0",
    );
    const headingLastSchedule = headingLastUnit
      ? scheduler.get(headingLastUnit.id)
      : undefined;
    const followingFirstSchedule = followingFirstUnit
      ? scheduler.get(followingFirstUnit.id)
      : undefined;

    expect(headingLastUnit).toMatchObject({
      intervalsAfter: 6,
      value: "g",
    });
    expect(headingLastUnit?.delayAfter).toBeUndefined();
    expect(
      (followingFirstSchedule?.startAt ?? 0) -
        (headingLastSchedule?.startAt ?? 0),
    ).toBe(30);
  });

  it("paces a horizontal rule relatively with a longer overlapping reveal", () => {
    const source = "Before\n\n---\n\nAfter";
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });
    scheduler.enqueue(plan.units);

    const rule = plan.units.find((unit) => unit.kind === "block");
    const followingUnit = rule
      ? plan.units.find((unit) => unit.order === rule.order + 1)
      : undefined;
    const ruleSchedule = rule ? scheduler.get(rule.id) : undefined;
    const followingSchedule = followingUnit
      ? scheduler.get(followingUnit.id)
      : undefined;

    expect(rule).toMatchObject({
      allowFollowingFinishOverlap: true,
      durationMultiplier: 3,
      intervalsAfter: 12,
      value: "",
    });
    expect(rule?.delayAfter).toBeUndefined();
    expect(rule?.duration).toBeUndefined();
    expect(ruleSchedule?.duration).toBe(1200);
    expect(
      (followingSchedule?.startAt ?? 0) - (ruleSchedule?.startAt ?? 0),
    ).toBe(60);
    expect(scheduler.snapshot().lastEndAt).toBe(ruleSchedule?.endAt);
  });

  it("commits stable nested items inside an open parent item", () => {
    const source = [
      "- Parent item",
      "  - Nested one is committed",
      "  - Nested two is open",
    ].join("\n");
    const firstNestedStart = source.indexOf("  - Nested one") + 2;
    const secondNestedStart = source.indexOf("  - Nested two") + 2;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });

    expect(
      plan.units
        .filter((unit) => unit.blockId === "block:0")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("Parentitem");
    expect(
      plan.units
        .filter((unit) => unit.blockId === `block:${firstNestedStart}`)
        .map((unit) => unit.value)
        .join(""),
    ).toBe("Nestedoneiscommitted");
    expect(
      plan.units.filter(
        (unit) => unit.blockId === `block:${secondNestedStart}`,
      ),
    ).toHaveLength(0);
    expect(plan.confirmedBlockIds.has("block:0")).toBe(false);
    expect(
      plan.confirmedBlockIds.has(`block:${firstNestedStart}`),
    ).toBe(false);
  });

  it("plans fenced code, tables, and quotes as blocks inside list items", () => {
    const fence = "`".repeat(3);
    const source = [
      "1. Outer ordered item.",
      "",
      `   ${fence}ts`,
      "   const outerOl = \"level-1\";",
      `   ${fence}`,
      "",
      "   - Nested unordered item.",
      "",
      "     | Col | Value |",
      "     | --- | --- |",
      "     | nested | table |",
      "",
      "     > Quoted nested prose.",
      "",
      "     1. Nested ordered item.",
      "",
      `        ${fence}ts`,
      "        const nestedOl = \"level-3\";",
      `        ${fence}`,
      "",
    ].join("\n");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });
    const codeLines = plan.units.filter((unit) => unit.kind === "code-line");
    const tableRows = plan.units.filter((unit) => unit.kind === "table-row");

    expect(codeLines.map((unit) => unit.value)).toEqual([
      "const outerOl = \"level-1\";",
      "const nestedOl = \"level-3\";",
    ]);
    expect(tableRows.map((unit) => unit.value)).toEqual([
      "Col\nValue",
      "nested\ntable",
    ]);
    expect(
      plan.units
        .filter((unit) => unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toContain("Quotednestedprose.");
  });

  it("keeps the prose lead inside a long open ordered-list item", () => {
    const source = `1. ${"flowing ordered item ".repeat(6)}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const safeEnd = source.length - 48;

    expect(plan.units.length).toBeGreaterThan(0);
    expect(
      plan.units.every((unit) => unit.sourceRange.end <= safeEnd),
    ).toBe(true);
    expect(plan.confirmedBlockIds.has("block:0")).toBe(false);
  });

  it("keeps character cadence continuous as an open list item gains text", () => {
    const openSource = `- Lists ${"x".repeat(47)}`;
    const openPlan = createMarkdownPlan(
      parseMarkdown(openSource),
      openSource,
      { inputOpen: true },
    );
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });
    const lastSafeUnit = openPlan.units.at(-1);

    expect(openPlan.units.map((unit) => unit.value).join("")).toBe("Lists");
    expect(lastSafeUnit?.value).toBe("s");
    expect(lastSafeUnit?.delayAfter).toBeUndefined();
    scheduler.enqueue(openPlan.units);

    const closedPlan = createMarkdownPlan(
      parseMarkdown(openSource),
      openSource,
      { inputOpen: false },
    );
    scheduler.enqueue(closedPlan.units);
    const followingUnit = closedPlan.units.find(
      (unit) => unit.order === (lastSafeUnit?.order ?? -1) + 1,
    );
    const lastSafeSchedule = lastSafeUnit
      ? scheduler.get(lastSafeUnit.id)
      : undefined;
    const followingSchedule = followingUnit
      ? scheduler.get(followingUnit.id)
      : undefined;

    expect(followingUnit?.value).toBe("x");
    expect(
      (followingSchedule?.startAt ?? 0) - (lastSafeSchedule?.startAt ?? 0),
    ).toBe(5);
  });

  it("starts every character in a word together in word reveal mode", () => {
    const source = "Alpha beta.";
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
      reveal: "word",
    });
    const scheduled = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    }).enqueue(plan.units.filter((unit) => unit.kind === "text"));
    const alpha = scheduled.slice(0, 5);
    const beta = scheduled.slice(5);

    expect(new Set(alpha.map((unit) => unit.startAt))).toEqual(new Set([0]));
    expect(new Set(beta.map((unit) => unit.startAt))).toEqual(new Set([25]));
    expect(alpha.at(-1)?.intervalsAfter).toBe(5);
  });

  it("adds list rhythm only when a following item confirms the boundary", () => {
    const openSource = `- Lists${"x".repeat(47)}`;
    const openPlan = createMarkdownPlan(
      parseMarkdown(openSource),
      openSource,
      { inputOpen: true },
    );
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });
    scheduler.enqueue(openPlan.units);

    const completeSource = `${openSource}\n- Next`;
    const completePlan = createMarkdownPlan(
      parseMarkdown(completeSource),
      completeSource,
      { inputOpen: false },
    );
    scheduler.enqueue(completePlan.units);

    const firstItemUnits = completePlan.units.filter(
      (unit) => unit.blockId === "block:0",
    );
    const secondItemStart = completeSource.indexOf("- Next");
    const secondItemFirstUnit = completePlan.units.find(
      (unit) => unit.blockId === `block:${secondItemStart}`,
    );
    const firstItemLastUnit = firstItemUnits.at(-1);
    const firstItemLastSchedule = firstItemLastUnit
      ? scheduler.get(firstItemLastUnit.id)
      : undefined;
    const secondItemFirstSchedule = secondItemFirstUnit
      ? scheduler.get(secondItemFirstUnit.id)
      : undefined;

    expect(secondItemFirstUnit).toMatchObject({
      intervalsBefore: 4,
      value: "N",
    });
    expect(
      (secondItemFirstSchedule?.startAt ?? 0) -
        (firstItemLastSchedule?.startAt ?? 0),
    ).toBe(20);
  });

  it("reveals a safe prose prefix inside an open blockquote", () => {
    const source = `> ${"flowing quoted prose ".repeat(7)}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const safeEnd = source.length - 48;

    expect(plan.units.length).toBeGreaterThan(0);
    expect(plan.units.every((unit) => unit.kind === "text")).toBe(true);
    expect(
      plan.units.every((unit) => unit.sourceRange.end <= safeEnd),
    ).toBe(true);
    expect(plan.confirmedBlockIds.size).toBe(0);
  });

  it("admits quoted code lines without treating quote prefixes as code", () => {
    const source = [
      "> ```ts",
      "> const ready = true;",
      "> ```",
      "",
      "After the quote.",
    ].join("\n");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const lines = plan.units.filter((unit) => unit.kind === "code-line");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: "code-line:2:0",
      sourceRange: {
        start: source.indexOf("const ready"),
      },
      value: "const ready = true;",
    });
  });

  it("withholds a thematic break until its line is complete", () => {
    const openSource = "***";
    const openPlan = createMarkdownPlan(
      parseMarkdown(openSource),
      openSource,
      { inputOpen: true },
    );
    const closedSource = "***\n";
    const closedPlan = createMarkdownPlan(
      parseMarkdown(closedSource),
      closedSource,
      { inputOpen: true },
    );

    expect(openPlan.units).toHaveLength(0);
    expect(closedPlan.units).toMatchObject([
      { id: "block:0:3", kind: "block", value: "" },
    ]);
  });

  it("plans each confirmed table row before its character content", () => {
    const openSource = [
      "| Product | Revenue |",
      "| --- | ---: |",
      "| Smoothstream | $12k |",
      "| Cream | $9k |",
    ].join("\n");
    const openPlan = createMarkdownPlan(
      parseMarkdown(openSource),
      openSource,
      { inputOpen: true },
    );
    const closedSource = `${openSource}\n\nNext paragraph`;
    const closedPlan = createMarkdownPlan(
      parseMarkdown(closedSource),
      closedSource,
      { inputOpen: true },
    );

    expect(openPlan.units).toHaveLength(0);
    const rows = closedPlan.units.filter((unit) => unit.kind === "table-row");
    expect(rows).toHaveLength(3);
    const header = rows[0];
    const smoothstream = rows[1];
    expect(header).toBeDefined();
    expect(smoothstream).toBeDefined();
    expect(
      closedPlan.units
        .filter((unit) => unit.blockId === header?.blockId && unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("ProductRevenue");
    expect(
      closedPlan.units
        .filter((unit) => unit.blockId === smoothstream?.blockId && unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("Smoothstream$12k");
    expect(closedPlan.units[0]?.kind).toBe("table-row");
    expect(closedPlan.units[0]).toMatchObject({ intervalsAfter: 2 });
    expect(closedPlan.units[1]).toMatchObject({ kind: "text", value: "P" });
    expect(
      closedPlan.units.filter((unit) => unit.blockId === header?.blockId).at(-1),
    ).toMatchObject({ intervalsAfter: 2 });
  });

  it("does not commit provisional prose while a table separator forms", () => {
    const source = [
      "A settled paragraph with enough text to enter the timeline before the table.",
      "",
      "| Identifier | Status | Owner | Priority | Created | Updated | Target | Region | Runtime | Retries | Latency | Notes |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| BS-1042 | Ready | Ana | High | Aug 12 | Aug 18 | Web | Toronto | React | 2 | 84 ms | Stable |",
      "| BS-1043 | Review | Kai | Medium | Aug 14 | Aug 18 | Mobile | London | Astro | 0 | 112 ms | Pending |",
      "",
      "After the table.",
    ].join("\n");
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 180,
      interval: 30,
    });

    expect(() => {
      for (let cursor = 13; cursor < source.length; cursor += 13) {
        const snapshot = source.slice(0, cursor);
        const plan = createMarkdownPlan(parseMarkdown(snapshot), snapshot, {
          inputOpen: true,
        });
        scheduler.enqueue(plan.units);
      }
      const finishedPlan = createMarkdownPlan(parseMarkdown(source), source, {
        inputOpen: false,
      });
      scheduler.enqueue(finishedPlan.units);
    }).not.toThrow();
  });

  it("withholds a long potential table header before its separator arrives", () => {
    const header =
      "| Identifier | Status | Owner | Priority | Created | Updated | Target | Region | Runtime | Retries | Latency | Notes |";
    const plan = createMarkdownPlan(parseMarkdown(header), header, {
      inputOpen: true,
    });

    expect(header.length).toBeGreaterThan(48);
    expect(plan.units).toHaveLength(0);
  });

  it("contains unmatched emphasis inside its paragraph", () => {
    const source = [
      "**This remains literal",
      "",
      "# A clean heading",
      "",
    ].join("\n");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const headingTextStart = source.indexOf("A clean heading");
    const literalParagraph = plan.units
      .filter((unit) => unit.sourceRange.end <= headingTextStart)
      .map((unit) => unit.value)
      .join("");
    const heading = plan.units
      .filter((unit) => unit.sourceRange.start >= headingTextStart)
      .map((unit) => unit.value)
      .join("");

    expect(heading).toBe("Acleanheading");
    expect(heading).not.toContain("**");
    expect(literalParagraph).toContain("**This");
  });

  it("allows safe prose before an unresolved inline structure to flow", () => {
    const safePrefix =
      "The beginning of this sentence is ordinary prose and can start revealing while a later ";
    const source = `${safePrefix}**deliberate inline phrase remains unresolved long enough for the marker itself to become the active boundary`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const revealedText = plan.units
      .filter((unit) => unit.kind === "text")
      .map((unit) => unit.value)
      .join("");

    expect(revealedText).toBe(safePrefix.replaceAll(/\s/gu, ""));
    expect(revealedText).not.toContain("deliberate");
    expect(revealedText).not.toContain("*");
  });

  it("plans confirmed inline semantics as groups before their characters", () => {
    const source = [
      "[Docs](https://example.com)",
      "`npm install`",
      "~~complete~~",
    ].join(" and ");
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });

    expect(
      plan.units
        .filter((unit) => unit.kind === "inline")
        .map((unit) => unit.value),
    ).toEqual(["npm install", "complete"]);
    expect(plan.units[0]).toMatchObject({
      intervalsAfter: 2,
      id: "link:0:27",
      kind: "link",
      value: "Docs",
    });
    expect(plan.units[1]).toMatchObject({ kind: "text", value: "D" });
  });

  it("keeps a late reference link provisional until its definition arrives", () => {
    const usage =
      "Leading prose can reveal before the unresolved [guide][docs] candidate.";
    const unresolvedSource = `${usage}\n\n`;
    const unresolvedPlan = createMarkdownPlan(
      parseMarkdown(unresolvedSource),
      unresolvedSource,
      { inputOpen: true },
    );

    expect(
      unresolvedPlan.units.map((unit) => unit.value).join(""),
    ).not.toContain("guide");
    expect(unresolvedPlan.units.some((unit) => unit.kind === "link")).toBe(
      false,
    );
    expect(unresolvedPlan.confirmedBlockIds).not.toContain("block:0");

    const resolvedSource =
      `${unresolvedSource}[docs]: https://example.com/guide\n\n`;
    const resolvedPlan = createMarkdownPlan(
      parseMarkdown(resolvedSource),
      resolvedSource,
      { inputOpen: true },
    );
    const link = resolvedPlan.units.find((unit) => unit.kind === "link");

    expect(link).toMatchObject({ value: "guide" });
    expect(resolvedPlan.confirmedBlockIds).toContain("block:0");
  });

  it("does not hold a business annotation that cannot open emphasis", () => {
    const source = `** Business note remains literal. ${"x".repeat(80)}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });

    expect(plan.units.slice(0, 3)).toMatchObject([
      { kind: "text", value: "*" },
      { kind: "text", value: "*" },
      { kind: "text", value: "B" },
    ]);
    expect(plan.units.some((unit) => unit.kind === "inline")).toBe(false);
  });

  it("plans complete fenced-code lines as character reveal units", () => {
    const fence = "`".repeat(3);
    const source = `${fence}ts\nconst smoothstream = true;\nship(smoothstream);\n${fence}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });

    expect(plan.units.filter((unit) => unit.kind === "code-line")).toMatchObject([
      { id: "code-line:0:0", kind: "code-line", value: "const smoothstream = true;" },
      { id: "code-line:0:1", kind: "code-line", value: "ship(smoothstream);" },
    ]);
    expect(plan.units[1]).toMatchObject({
      id: "code-character:0:0:0",
      kind: "text",
      value: "c",
    });
    expect(
      plan.units
        .filter((unit) => unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("const smoothstream = true;ship(smoothstream);");
  });

  it("groups fenced-code characters by word without compressing their cadence", () => {
    const fence = "`".repeat(3);
    const source = `${fence}txt\nab cd\n${fence}`;
    const plan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
      reveal: "word",
    });
    const scheduled = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    }).enqueue(plan.units);
    const valueById = new Map(plan.units.map((unit) => [unit.id, unit.value]));
    const characters = scheduled.filter((unit) =>
      unit.id.startsWith("code-character:")
    );

    expect(
      characters.map((unit) => [valueById.get(unit.id), unit.startAt]),
    ).toEqual([
      ["a", 10],
      ["b", 10],
      [" ", 25],
      ["c", 25],
      ["d", 25],
    ]);
  });

  it("withholds an incomplete code tail and confirms it independently of the closing fence", () => {
    const fence = "`".repeat(3);
    const partialSource = `${fence}ts\nconst ready = true;\nship(`;
    const partialPlan = createMarkdownPlan(
      parseMarkdown(partialSource),
      partialSource,
      { inputOpen: true },
    );
    const completedSource = `${partialSource}ready);\n`;
    const completedPlan = createMarkdownPlan(
      parseMarkdown(completedSource),
      completedSource,
      { inputOpen: true },
    );
    const closedSource = `${completedSource}${fence}`;
    const closedPlan = createMarkdownPlan(
      parseMarkdown(closedSource),
      closedSource,
      { inputOpen: true },
    );

    expect(
      partialPlan.units.filter((unit) => unit.kind === "code-line"),
    ).toHaveLength(1);
    expect(partialPlan.units.map((unit) => unit.value).join(""))
      .not.toContain("ship(");
    expect(partialPlan.confirmedBlockIds.has("block:0")).toBe(false);

    expect(
      completedPlan.units.filter((unit) => unit.kind === "code-line"),
    ).toHaveLength(2);
    expect(
      completedPlan.units
        .filter((unit) => unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toContain("ship(ready);");
    expect(completedPlan.confirmedBlockIds.has("block:0")).toBe(false);

    expect(closedPlan.units.map((unit) => unit.id)).toEqual(
      completedPlan.units.map((unit) => unit.id),
    );
    expect(closedPlan.confirmedBlockIds.has("block:0")).toBe(true);
  });

  it("flushes an unterminated final code line when input closes", () => {
    const fence = "`".repeat(3);
    const source = `${fence}ts\nreturn true;`;
    const openPlan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: true,
    });
    const closedPlan = createMarkdownPlan(parseMarkdown(source), source, {
      inputOpen: false,
    });

    expect(openPlan.units).toHaveLength(0);
    expect(
      closedPlan.units
        .filter((unit) => unit.kind === "text")
        .map((unit) => unit.value)
        .join(""),
    ).toBe("return true;");
    expect(closedPlan.confirmedBlockIds.has("block:0")).toBe(true);
  });
});
