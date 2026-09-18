import type {
  Element as HastElement,
  Node as HastNode,
  Parent as HastParent,
} from "hast";
import { describe, expect, it } from "vitest";
import { StreamingSession, type StreamingInputSnapshot } from "@smoothstream/core";
import {
  createWebPresentation,
  type WebElementNode,
  type WebRenderNode,
} from "@smoothstream/core/web";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";

const session = (prefix = "") => new StreamingSession(
  { now: () => 100 },
  { duration: 100, interval: 10, footnoteIdPrefix: prefix },
);

const project = (
  engine: StreamingSession,
  input: StreamingInputSnapshot,
  immediate = false,
): ReadonlyArray<WebRenderNode> => {
  const playback = immediate ? engine.immediate(input) : engine.schedule(input);
  const presentation = engine.present(input, playback, { now: 100_000 });
  return createWebPresentation({
    codeHighlighterEnabled: false,
    codeHighlights: new Map(),
    compactedBlockIds: presentation.compactedBlockIds,
    compactedUnitIds: presentation.compactedUnitIds,
    confirmedBlockIds: input.plan.confirmedBlockIds,
    images: new Map(),
    immediate,
    now: presentation.now,
    reveal: input.reveal,
    schedules: playback.schedules,
    tree: input.plan.tree,
    units: input.plan.units,
  });
};

const elements = (
  nodes: ReadonlyArray<WebRenderNode>,
): WebElementNode[] => nodes.flatMap((node) =>
  node.type === "element" ? [node, ...elements(node.children)] : []
);

const content = (nodes: ReadonlyArray<WebRenderNode>): string =>
  nodes.map((node) =>
    node.type === "text" ? node.value : content(node.children)
  ).join("");

const hastElements = (node: HastNode): HastElement[] => {
  const result: HastElement[] = [];
  const visit = (child: HastNode): void => {
    if (child.type === "element") result.push(child as HastElement);
    if ("children" in child) {
      (child as HastParent).children.forEach((descendant) =>
        visit(descendant as HastNode)
      );
    }
  };
  visit(node);
  return result;
};

describe("footnotes", () => {
  it("renders source-backed definitions in streaming and static presentations", () => {
    const markdown = "Claim[^note].\n\n[^note]: Supporting **detail**.\n";
    for (const immediate of [false, true]) {
      const engine = session();
      const input = engine.prepareInput(markdown, false);
      const nodes = project(engine, input, immediate);
      const section = elements(nodes).find((node) => node.tagName === "section");
      expect(section?.properties.dataFootnotes).toBe(true);
      expect(content(nodes)).toContain("Supporting detail.");
      expect(elements(nodes).some((node) => node.tagName === "strong")).toBe(true);
      expect(input.plan.units.some((unit) => unit.kind === "footnote")).toBe(true);
    }
  });

  it("keeps references, targets, and repeated back links in one instance namespace", () => {
    const markdown = "First[^note] and again[^note].\n\n[^note]: Detail.\n";
    const tree = parseMarkdown(markdown, { footnoteIdPrefix: "message-a-" });
    const nodes = hastElements(tree);
    const refs = nodes.filter((node) => node.properties.dataFootnoteRef === true);
    const backrefs = nodes.filter((node) =>
      node.properties.dataFootnoteBackref !== undefined
    );
    const targets = new Set(nodes.map((node) => node.properties.id));
    expect(refs).toHaveLength(2);
    expect(backrefs).toHaveLength(2);
    for (const link of [...refs, ...backrefs]) {
      expect(link.properties.id ?? link.properties.href).toBeDefined();
      const href = String(link.properties.href);
      expect(href.startsWith("#message-a-")).toBe(true);
      expect(targets.has(href.slice(1))).toBe(true);
    }
    expect(parseMarkdown(markdown, { footnoteIdPrefix: "message-b-" }))
      .not.toEqual(tree);
  });

  it("lets prose continue past a provisional reference and waits for its definition", () => {
    const engine = session("stream-");
    const before = "A claim[^source] continues with enough prose to pass the lookahead while the definition has not arrived.";
    const pending = engine.prepareInput(before, true);
    expect(pending.plan.units.map((unit) => unit.value).join(""))
      .toContain("continues");
    const pendingNodes = project(engine, pending);
    const pendingRef = elements(pendingNodes).find((node) =>
      node.properties.dataFootnoteRef === true
    );
    expect(pendingRef?.properties.href).toBeUndefined();
    expect(elements(pendingNodes).some((node) => node.tagName === "section"))
      .toBe(false);

    engine.commitInput(pending);
    const withOpenDefinition = engine.prepareInput(`${before}\n\n[^source]: Evidence`, true);
    expect(withOpenDefinition.plan.units.some((unit) => unit.kind === "footnote"))
      .toBe(false);
    engine.commitInput(withOpenDefinition);
    const complete = engine.prepareInput(`${before}\n\n[^source]: Evidence\n\n`, true);
    const nodes = project(engine, complete);
    const reference = elements(nodes).find((node) =>
      node.properties.dataFootnoteRef === true
    );
    expect(reference?.properties.href).toMatch(/^#stream-/u);
    expect(content(nodes)).toContain("Evidence");
  });

  it("keeps list numbering when an earlier note is still pending", () => {
    const engine = session();
    const source = [
      "First[^one], then second[^two].",
      "",
      "[^two]: Ready.",
      "",
      "[^one]: Still being written",
    ].join("\n");
    const input = engine.prepareInput(source, true);
    const nodes = project(engine, input, true);
    const notes = elements(nodes).filter((node) => node.tagName === "li" &&
      node.properties["data-smoothstream-footnote-definition"] === true);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.properties.value).toBe("2");
    expect(content(notes)).toContain("Ready.");
  });

  it("shows unresolved syntax as literal text when input closes", () => {
    const engine = session();
    const input = engine.prepareInput("A claim[^missing] without a note.", false);
    const nodes = project(engine, input, true);
    expect(content(nodes)).toContain("[^missing]");
    expect(elements(nodes).some((node) => node.tagName === "section"))
      .toBe(false);
  });

  it("does not create provisional notes from code or escaped markers", () => {
    const markdown = [
      "Escaped \\[^code] and `[^inline]`.",
      "",
      "```txt",
      "[^block]",
      "```",
    ].join("\n");
    const tree = parseMarkdown(markdown, { inputOpen: true });
    expect(hastElements(tree).filter((node) =>
      node.properties.dataFootnoteRef === true
    )).toHaveLength(0);
  });

  it("supports punctuation in late footnote labels", () => {
    const tree = parseMarkdown("Claim[^paper.2026] continues.", {
      inputOpen: true,
    });
    const reference = hastElements(tree).find((node) =>
      node.properties.dataFootnoteRef === true
    );
    expect(reference?.properties["data-smoothstream-footnote-pending"])
      .toBe(true);
  });
});
