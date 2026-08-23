import type { Element, Node, Parent, Text } from "hast";
import { describe, expect, it } from "vitest";
import { RevealScheduler } from "../../packages/core/src/scheduler";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";
import { createMarkdownPlan } from "../../packages/core/src/markdown/unitize";
import { markdownCases } from "../fixtures/markdown-cases";
import { streamCases } from "../fixtures/stream-cases";

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;
const isText = (node: Node): node is Text => node.type === "text";

const semanticValue = (node: Node): unknown => {
  if (isText(node)) {
    return node.value;
  }
  if (isElement(node)) {
    return {
      children: node.children.map(semanticValue),
      properties: node.properties,
      tagName: node.tagName,
    };
  }
  if (isParent(node)) {
    return node.children.map(semanticValue);
  }
  return node.type;
};

const findElementStartingAt = (
  node: Node,
  start: number,
): Element | undefined => {
  if (isParent(node)) {
    for (const child of node.children) {
      const match = findElementStartingAt(child, start);
      if (match) {
        return match;
      }
    }
  }
  return isElement(node) && node.position?.start.offset === start
    ? node
    : undefined;
};

describe("streaming Markdown prefix stability", () => {
  it("keeps word-mode schedules append-only as a word crosses the lookahead frontier", () => {
    const markdown = [
      "A buffered sentence keeps complete words stable while later packets",
      " extend the same open paragraph without revising an existing schedule.",
    ].join("");
    const scheduler = new RevealScheduler({ now: () => 0 }, {
      duration: 400,
      interval: 5,
    });

    for (let end = 1; end <= markdown.length; end += 1) {
      const source = markdown.slice(0, end);
      const plan = createMarkdownPlan(parseMarkdown(source), source, {
        inputOpen: true,
        reveal: "word",
      });
      expect(() => scheduler.enqueue(plan.units)).not.toThrow();
    }

    const finalPlan = createMarkdownPlan(parseMarkdown(markdown), markdown, {
      inputOpen: false,
      reveal: "word",
    });
    expect(() => scheduler.enqueue(finalPlan.units)).not.toThrow();
  });

  it.each(streamCases)(
    "$label keeps its delivery sequence append-only in the scheduler",
    (scenario) => {
      const scheduler = new RevealScheduler({ now: () => 0 }, {
        duration: 400,
        interval: 5,
      });
      let source = "";

      for (const delivery of scenario.deliveries) {
        source += delivery.text;
        const plan = createMarkdownPlan(parseMarkdown(source), source, {
          inputOpen: true,
        });
        expect(() => scheduler.enqueue(plan.units)).not.toThrow();
      }

      const finalPlan = createMarkdownPlan(parseMarkdown(source), source, {
        inputOpen: false,
      });
      expect(() => scheduler.enqueue(finalPlan.units)).not.toThrow();
    },
  );

  it.each(markdownCases)(
    "$name keeps schedules and confirmed structures stable",
    ({ markdown }) => {
      const scheduler = new RevealScheduler({ now: () => 0 }, {
        duration: 400,
        interval: 5,
      });
      const confirmedStructures = new Map<string, string>();
      const originalSchedules = new Map<
        string,
        { readonly endAt: number; readonly startAt: number }
      >();

      for (let end = 1; end <= markdown.length; end += 1) {
        const source = markdown.slice(0, end);
        const plan = createMarkdownPlan(parseMarkdown(source), source, {
          inputOpen: true,
        });
        const schedules = scheduler.enqueue(plan.units);

        for (const schedule of schedules) {
          const original = originalSchedules.get(schedule.id);
          if (original) {
            expect(schedule).toMatchObject(original);
          } else {
            originalSchedules.set(schedule.id, {
              endAt: schedule.endAt,
              startAt: schedule.startAt,
            });
          }
        }

        for (const blockId of plan.confirmedBlockIds) {
          const start = Number(blockId.slice("block:".length));
          const element = findElementStartingAt(plan.tree, start);
          expect(element, `missing ${blockId} at prefix ${end}`).toBeDefined();
          const structure = JSON.stringify(semanticValue(element as Element));
          const original = confirmedStructures.get(blockId);
          if (original) {
            expect(structure).toBe(original);
          } else {
            confirmedStructures.set(blockId, structure);
          }
        }
      }

      const finalPlan = createMarkdownPlan(parseMarkdown(markdown), markdown, {
        inputOpen: false,
      });
      expect(() => scheduler.enqueue(finalPlan.units)).not.toThrow();
    },
  );
});
