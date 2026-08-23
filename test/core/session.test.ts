import { describe, expect, it } from "vitest";
import type { CodeHighlighter } from "../../packages/core/src/code-types";
import {
  resolveCodeHighlight,
  unitsReadyForCodeHighlights,
} from "../../packages/core/src/code-highlighting";
import { StreamingSession } from "../../packages/core/src/session";
import type { Clock } from "../../packages/core/src/types";

class ManualClock implements Clock {
  constructor(public time = 0) {}

  now(): number {
    return this.time;
  }
}

const createSession = (clock = new ManualClock()): StreamingSession =>
  new StreamingSession(clock, { duration: 100, interval: 10 });

describe("StreamingSession", () => {
  it("prepares framework-neutral renderer work from one Markdown snapshot", () => {
    const session = createSession();
    const input = session.prepareInput(
      [
        "A status ![ready](https://example.com/ready.svg)",
        "",
        "- First item",
        "- Second item",
        "",
        "```ts",
        "const ready = true;",
        "```",
      ].join("\n"),
      false,
    );

    expect(input.images).toMatchObject([
      { src: "https://example.com/ready.svg" },
    ]);
    expect(input.codeBlocks).toMatchObject([
      {
        code: "const ready = true;\n",
        language: "ts",
        lines: ["const ready = true;"],
      },
    ]);
    expect(input.unitSignature).toBe(
      input.plan.units.map((unit) => unit.id).join("|"),
    );
  });

  it("checks append-only continuity against committed adapter input", () => {
    const session = createSession();
    const first = session.prepareInput("First response", true);

    // Preparing a speculative render does not mutate committed continuity.
    expect(() => session.prepareInput("Different render", true)).not.toThrow();

    session.commitInput(first);
    expect(() => session.prepareInput("First response grows", true)).not.toThrow();
    expect(() => session.prepareInput("Different response", true)).toThrow(
      /source must be append-only/,
    );
  });

  it("owns scheduling, visibility, and confirmed-block compaction", () => {
    const clock = new ManualClock(20);
    const session = createSession(clock);
    const input = session.prepareInput(
      "# Complete heading\n\nA complete paragraph.",
      false,
    );
    session.commitInput(input);

    const initial = session.schedule(input);
    expect(initial.immediate).toBe(false);
    expect(initial.schedules.size).toBe(input.plan.units.length);
    expect(initial.visibleUnitCount).toBeGreaterThan(0);
    expect(session.present(input, initial).allPlannedUnitsCompacted).toBe(false);

    clock.time = 10_000;
    const completed = session.advance();
    const presentation = session.present(input, completed);

    expect(completed.animationComplete).toBe(true);
    expect(completed.visibleUnitCount).toBe(input.plan.units.length);
    expect(presentation.allPlannedUnitsCompacted).toBe(true);
    expect(presentation.compactedUnitIds.size).toBe(input.plan.units.length);
  });

  it("keeps an open provisional block un-compacted after its animation ends", () => {
    const clock = new ManualClock();
    const session = createSession(clock);
    const source = "An open paragraph keeps streaming long enough to cross the lookahead frontier.";
    const input = session.prepareInput(source, true);
    session.commitInput(input);
    expect(input.plan.units.length).toBeGreaterThan(0);

    session.schedule(input);
    clock.time = 10_000;
    const presentation = session.present(input, session.advance());

    expect(presentation.animationComplete).toBe(true);
    expect(presentation.compactedBlockIds.size).toBe(0);
    expect(presentation.allPlannedUnitsCompacted).toBe(false);
  });

  it("compacts every planned block immediately when motion is disabled", () => {
    const clock = new ManualClock(50);
    const session = createSession(clock);
    const input = session.prepareInput(
      "An open paragraph still has provisional structure while input remains open.",
      true,
    );
    const playback = session.immediate(input);
    const presentation = session.present(input, playback);

    expect(playback.visibleUnitCount).toBe(input.plan.units.length);
    expect([...playback.schedules.values()].every(
      (unit) => unit.startAt === 50 && unit.endAt === 50 && unit.duration === 0,
    )).toBe(true);
    expect(presentation.allPlannedUnitsCompacted).toBe(true);
    expect(presentation.compactedUnitIds.size).toBe(input.plan.units.length);
  });

  it("withholds code units until neutral highlighting results are stable", () => {
    const session = createSession();
    const input = session.prepareInput(
      "Before.\n\n```ts\nconst one = 1;\nconst two = 2;\n```\n\nAfter.",
      false,
    );
    const request = input.codeBlocks[0];
    expect(request).toBeDefined();
    if (!request) {
      return;
    }
    const highlighter = { name: "test" } as CodeHighlighter;
    const firstCodeUnit = input.plan.units.findIndex(
      (unit) => unit.kind === "code-line",
    );

    expect(
      unitsReadyForCodeHighlights(input.plan.units, highlighter, new Map()),
    ).toHaveLength(firstCodeUnit);

    const resolved = resolveCodeHighlight(request, {
      languageLabel: "TypeScript",
      lines: request.lines.map((line) => ({ tokens: [{ content: line }] })),
    });
    const highlights = new Map([[request.blockStart, resolved]]);
    expect(
      unitsReadyForCodeHighlights(input.plan.units, highlighter, highlights),
    ).toHaveLength(input.plan.units.length);
  });

  it("preserves previously accepted highlighted lines as a code block grows", () => {
    const firstRequest = {
      blockStart: 0,
      code: "const one = 1;\n",
      language: "ts",
      lines: ["const one = 1;"],
    };
    const first = resolveCodeHighlight(firstRequest, {
      languageLabel: "TypeScript",
      lines: [{
        tokens: [{ content: "const one = 1;", style: { color: "red" } }],
      }],
    });
    const second = resolveCodeHighlight(
      {
        ...firstRequest,
        code: "const one = 1;\nconst two = 2;\n",
        lines: ["const one = 1;", "const two = 2;"],
      },
      {
        lines: [
          { tokens: [{ content: "const one = 1;", style: { color: "blue" } }] },
          { tokens: [{ content: "const two = 2;", style: { color: "green" } }] },
        ],
      },
      first,
    );

    expect(second.lines[0]).toBe(first.lines[0]);
    expect(second.lines[1]?.tokens[0]?.content).toBe("const two = 2;");
    expect(second.languageLabel).toBe("TypeScript");
  });

  it("keeps a persistent session valid across every incoming prefix", () => {
    const session = createSession();
    const markdown = "## Heading\n\nA paragraph with **bold text** and a [link](https://example.com).";

    for (let end = 1; end <= markdown.length; end += 1) {
      const input = session.prepareInput(markdown.slice(0, end), true);
      session.commitInput(input);
      expect(() => session.schedule(input)).not.toThrow();
    }

    const finalInput = session.prepareInput(markdown, false);
    session.commitInput(finalInput);
    expect(() => session.schedule(finalInput)).not.toThrow();
  });
});
