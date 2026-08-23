import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import {
  createElement,
  Fragment,
  memo,
  type CSSProperties,
  type Key,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { find, hastToReact, html } from "property-information";
import {
  createCodeCharacterUnitId,
  createCodeLineUnitId,
  createRangeUnitId,
  segmentGraphemes,
  type CodeHighlightLine,
  type GraphemeSegment,
  type ImageReadiness,
  MarkdownReveal,
  MarkdownRevealKind,
  MarkdownRevealUnit,
  type ResolvedCodeHighlight,
  type ScheduledUnit,
  SourceRange,
} from "@smoothstream/core";

const PRUNABLE_CONTAINERS = new Set([
  "a",
  "blockquote",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "thead",
  "ul",
]);

const INLINE_GROUP_TAGS = new Set(["a", "code", "del", "em", "strong"]);

interface RenderState {
  cache: HastRenderCache;
  codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  compactedBlockIds: ReadonlySet<string> | undefined;
  compactedUnitIds: CompactedUnitLookup;
  images: ReadonlyMap<string, ImageReadiness>;
  now: number;
  reveal: MarkdownReveal;
  schedules: ReadonlyMap<string, ScheduledUnit>;
}

interface CompactedUnitLookup {
  has(unitId: string): boolean;
}

type RuntimeStyle = CSSProperties & Record<`--${string}`, number | string>;

const runtimeStyle = (
  style: RuntimeStyle,
): Element["properties"]["style"] =>
  style as unknown as Element["properties"]["style"];

const writeClipboardText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy is unavailable");
  }
};

const codeCopyIcon = jsxs("svg", {
  "aria-hidden": true,
  "data-smoothstream-code-icon": "copy",
  fill: "none",
  focusable: "false",
  height: 24,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
  viewBox: "0 0 24 24",
  width: 24,
  children: [
    jsx("rect", { height: 14, rx: 2, ry: 2, width: 14, x: 8, y: 8 }),
    jsx("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }),
  ],
});

const codeCheckIcon = jsx("svg", {
  "aria-hidden": true,
  "data-smoothstream-code-icon": "check",
  fill: "none",
  focusable: "false",
  height: 24,
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
  viewBox: "0 0 24 24",
  width: 24,
  children: jsx("path", { d: "M20 6 9 17l-5-5" }),
});

interface EnhancedCodeBlockProps {
  readonly code: string;
  readonly copyReady: boolean;
  readonly content: ReactNode;
  readonly label: string;
  readonly properties: Record<string, unknown>;
}

const EnhancedCodeBlock = ({
  code,
  copyReady,
  content,
  label,
  properties,
}: EnhancedCodeBlockProps): ReactNode => {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setCopied(false);
    if (resetTimerRef.current !== undefined) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = undefined;
    }
  }, [code]);

  useEffect(() => () => {
    if (resetTimerRef.current !== undefined) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  const copy = async (): Promise<void> => {
    if (!copyReady) {
      return;
    }
    try {
      await writeClipboardText(code);
      setCopied(true);
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = undefined;
      }, 2_000);
    } catch {
      setCopied(false);
    }
  };

  return jsxs("pre", {
    ...properties,
    "data-smoothstream-code-block": true,
    children: [
      jsxs("span", {
        "data-smoothstream-code-toolbar": true,
        children: [
          jsx("span", {
            "data-smoothstream-code-language": true,
            children: label,
          }),
          jsx("button", {
            "aria-hidden": copyReady ? undefined : true,
            "aria-label": copied ? "Code copied" : `Copy ${label} code`,
            "data-smoothstream-code-copy": true,
            "data-smoothstream-ready": copyReady,
            disabled: !copyReady,
            onClick: () => void copy(),
            tabIndex: copyReady ? 0 : -1,
            type: "button",
            children: jsxs("span", {
              "aria-hidden": true,
              "data-smoothstream-code-icon-swap": true,
              "data-state": copied ? "check" : "copy",
              children: [codeCopyIcon, codeCheckIcon],
            }),
          }),
        ],
      }),
      content,
    ],
  });
};

export interface HastRenderCache {
  readonly blockTimingsByRoot: WeakMap<
    Root,
    WeakMap<
      ReadonlyMap<string, ScheduledUnit>,
      ReadonlyMap<string, HastBlockTiming>
    >
  >;
  readonly blocksByRoot: WeakMap<Root, ReadonlyArray<HastRenderBlock>>;
  readonly codeSchedulesBySnapshot: WeakMap<
    ReadonlyMap<string, ScheduledUnit>,
    WeakMap<Text, ResolvedCodeText>
  >;
  readonly graphemesByValue: Map<string, ReadonlyArray<GraphemeSegment>>;
  readonly preparedCodeByNode: WeakMap<Text, PreparedCodeText>;
  readonly preparedTextByNode: WeakMap<Text, PreparedText>;
  readonly textSchedulesBySnapshot: WeakMap<
    ReadonlyMap<string, ScheduledUnit>,
    WeakMap<Text, ReadonlyArray<ScheduledUnit | undefined>>
  >;
}

export const createHastRenderCache = (): HastRenderCache => ({
  blockTimingsByRoot: new WeakMap(),
  blocksByRoot: new WeakMap(),
  codeSchedulesBySnapshot: new WeakMap(),
  graphemesByValue: new Map(),
  preparedCodeByNode: new WeakMap(),
  preparedTextByNode: new WeakMap(),
  textSchedulesBySnapshot: new WeakMap(),
});

interface HastRenderBlock {
  readonly blockIds: ReadonlyArray<string>;
  readonly fingerprint: string;
  readonly imageUnits: ReadonlyArray<MarkdownRevealUnit>;
  readonly key: string;
  readonly node: RootContent;
  readonly unitSignature: string;
  readonly units: ReadonlyArray<MarkdownRevealUnit>;
}

interface HastBlockTiming {
  readonly endTimes: ReadonlyArray<number>;
  readonly startTimes: ReadonlyArray<number>;
}

interface PreparedTextSegment extends GraphemeSegment {
  readonly scheduleId?: string;
}

interface PreparedTextRun {
  readonly content: boolean;
  readonly indexes: ReadonlyArray<number>;
  readonly value: string;
}

interface PreparedText {
  readonly contentIndexes: ReadonlyArray<number>;
  readonly runs: ReadonlyArray<PreparedTextRun>;
  readonly segments: ReadonlyArray<PreparedTextSegment>;
}

interface PreparedCodeCharacter {
  readonly end: number;
  readonly scheduleId: string;
  readonly start: number;
  readonly value: string;
}

interface PreparedCodeLine {
  readonly characters: ReadonlyArray<PreparedCodeCharacter>;
  readonly scheduleId: string;
}

interface PreparedCodeText {
  readonly blockStart: number;
  readonly lines: ReadonlyArray<PreparedCodeLine>;
}

interface ResolvedCodeLine {
  readonly characterSchedules: ReadonlyArray<ScheduledUnit | undefined>;
  readonly schedule: ScheduledUnit | undefined;
}

interface ResolvedCodeText {
  readonly blockStart: number;
  readonly lines: ReadonlyArray<ResolvedCodeLine>;
}

const cachedGraphemes = (
  value: string,
  cache: HastRenderCache,
): ReadonlyArray<GraphemeSegment> => {
  const cached = cache.graphemesByValue.get(value);
  if (cached) {
    return cached;
  }

  const segments = segmentGraphemes(value);
  cache.graphemesByValue.set(value, segments);
  return segments;
};

const nodeRange = (node: Element | Text): SourceRange | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { end, start };
};

const prepareText = (
  node: Text,
  cache: HastRenderCache,
): PreparedText => {
  const cached = cache.preparedTextByNode.get(node);
  if (cached) {
    return cached;
  }

  const range = nodeRange(node);
  const contentIndexes: number[] = [];
  const segments = cachedGraphemes(node.value, cache).map(
    (segment, index): PreparedTextSegment => {
      if (!/\S/u.test(segment.value)) {
        return segment;
      }
      contentIndexes.push(index);
      return range
        ? {
            ...segment,
            scheduleId: createRangeUnitId("text", {
              end: range.start + segment.end,
              start: range.start + segment.start,
            }),
          }
        : segment;
    },
  );
  const runs: Array<{
    content: boolean;
    indexes: number[];
    value: string;
  }> = [];
  segments.forEach((segment, index) => {
    const content = /\S/u.test(segment.value);
    const previous = runs.at(-1);
    if (previous?.content === content) {
      previous.indexes.push(index);
      previous.value += segment.value;
      return;
    }
    runs.push({ content, indexes: [index], value: segment.value });
  });
  const prepared = { contentIndexes, runs, segments };
  cache.preparedTextByNode.set(node, prepared);
  return prepared;
};

const resolvedTextSchedules = (
  node: Text,
  state: RenderState,
): ReadonlyArray<ScheduledUnit | undefined> => {
  let schedulesByNode = state.cache.textSchedulesBySnapshot.get(
    state.schedules,
  );
  if (!schedulesByNode) {
    schedulesByNode = new WeakMap();
    state.cache.textSchedulesBySnapshot.set(state.schedules, schedulesByNode);
  }
  const cached = schedulesByNode.get(node);
  if (cached) {
    return cached;
  }

  const schedules = prepareText(node, state.cache).segments.map((segment) =>
    segment.scheduleId
      ? state.schedules.get(segment.scheduleId)
      : undefined
  );
  schedulesByNode.set(node, schedules);
  return schedules;
};

const prepareCodeText = (
  node: Text,
  blockStart: number,
  cache: HastRenderCache,
): PreparedCodeText => {
  const cached = cache.preparedCodeByNode.get(node);
  if (cached?.blockStart === blockStart) {
    return cached;
  }

  const lines = node.value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const prepared: PreparedCodeText = {
    blockStart,
    lines: lines.map((line, lineIndex) => ({
      characters: cachedGraphemes(line, cache).map(
        (segment, characterIndex) => ({
          end: segment.end,
          scheduleId: createCodeCharacterUnitId(
            blockStart,
            lineIndex,
            characterIndex,
          ),
          start: segment.start,
          value: segment.value,
        }),
      ),
      scheduleId: createCodeLineUnitId(blockStart, lineIndex),
    })),
  };
  cache.preparedCodeByNode.set(node, prepared);
  return prepared;
};

const resolvedCodeText = (
  node: Text,
  blockStart: number,
  state: RenderState,
): ResolvedCodeText => {
  let schedulesByNode = state.cache.codeSchedulesBySnapshot.get(
    state.schedules,
  );
  if (!schedulesByNode) {
    schedulesByNode = new WeakMap();
    state.cache.codeSchedulesBySnapshot.set(state.schedules, schedulesByNode);
  }
  const cached = schedulesByNode.get(node);
  if (cached?.blockStart === blockStart) {
    return cached;
  }

  const prepared = prepareCodeText(node, blockStart, state.cache);
  const resolved: ResolvedCodeText = {
    blockStart,
    lines: prepared.lines.map((line) => ({
      characterSchedules: line.characters.map((character) =>
        state.schedules.get(character.scheduleId)
      ),
      schedule: state.schedules.get(line.scheduleId),
    })),
  };
  schedulesByNode.set(node, resolved);
  return resolved;
};

const activeProperties = (
  properties: Element["properties"],
  schedule: ScheduledUnit,
  kind: MarkdownRevealKind,
): Element["properties"] => ({
  ...properties,
  "data-smoothstream-animation-duration": schedule.duration,
  "data-smoothstream-animation-start": schedule.startAt,
  "data-smoothstream-kind": kind,
  "data-smoothstream-unit": schedule.id,
  style: runtimeStyle({
    "--smoothstream-duration": `${schedule.duration}ms`,
  }),
});

const retainedTextProperties = (
  schedule: ScheduledUnit,
): Element["properties"] => ({
  "data-smoothstream-state": "settled",
  "data-smoothstream-unit": schedule.id,
});

const pendingTextProperties = (
  schedule: ScheduledUnit,
): Element["properties"] => ({
  "aria-hidden": true,
  "data-smoothstream-state": "pending",
  "data-smoothstream-unit": schedule.id,
  style: runtimeStyle({ visibility: "hidden" }),
});

const pendingInlineGroupProperties = (
  properties: Element["properties"],
  schedule: ScheduledUnit,
): Element["properties"] => ({
  ...properties,
  "aria-hidden": true,
  "data-smoothstream-state": "pending",
  "data-smoothstream-unit": schedule.id,
  style: runtimeStyle({ visibility: "hidden" }),
});

const retainedElementProperties = (
  properties: Element["properties"],
  schedule: ScheduledUnit,
): Element["properties"] => ({
  ...properties,
  "data-smoothstream-state": "settled",
  "data-smoothstream-unit": schedule.id,
});

const pendingTableRowProperties = (
  properties: Element["properties"],
  schedule: ScheduledUnit,
): Element["properties"] => ({
  ...properties,
  "aria-hidden": true,
  "data-smoothstream-state": "pending",
  "data-smoothstream-unit": schedule.id,
  // Collapsed rows take no vertical space but still inform table column widths.
  style: runtimeStyle({ visibility: "collapse" }),
});

const isVisible = (schedule: ScheduledUnit, now: number): boolean =>
  schedule.startAt <= now;

const isAnimating = (schedule: ScheduledUnit, now: number): boolean =>
  isVisible(schedule, now) && now < schedule.endAt;

const readinessSchedule = (
  schedule: ScheduledUnit,
  readiness: ImageReadiness,
): ScheduledUnit => {
  const startAt = Math.max(schedule.startAt, readiness.readyAt);
  return {
    ...schedule,
    endAt: startAt + schedule.duration,
    startAt,
  };
};

const elementRevealKind = (
  element: Element,
  insidePre: boolean,
): MarkdownRevealKind | undefined => {
  if (element.tagName === "tr") {
    return "table-row";
  }
  if (element.tagName === "img") {
    return "image";
  }
  if (element.tagName === "a" && !insidePre) {
    return "link";
  }
  if (INLINE_GROUP_TAGS.has(element.tagName) && !insidePre) {
    return "inline";
  }
  if (element.tagName === "hr") {
    return "block";
  }
  return undefined;
};

const hasVisibleTableRow = (
  node: Element,
  state: RenderState,
): boolean => node.children.some((child) => {
  if (child.type !== "element") {
    return false;
  }
  if (child.tagName !== "tr") {
    return hasVisibleTableRow(child, state);
  }

  const range = nodeRange(child);
  if (!range) {
    return false;
  }
  const schedule = state.schedules.get(
    createRangeUnitId("table-row", range),
  );
  return schedule !== undefined && isVisible(schedule, state.now);
});

const transformText = (
  node: Text,
  state: RenderState,
  retainPending: boolean,
  reserveBufferedWords: boolean,
): ElementContent[] => {
  const range = nodeRange(node);
  if (!range) {
    return [node];
  }

  const prepared = prepareText(node, state.cache);
  const schedules = resolvedTextSchedules(node, state);

  if (
    prepared.contentIndexes.length > 0 &&
    prepared.contentIndexes.every((index) => {
      const schedule = schedules[index];
      return schedule !== undefined && state.compactedUnitIds.has(schedule.id);
    })
  ) {
    return [node];
  }

  const result: ElementContent[] = [];
  for (const run of prepared.runs) {
    if (!run.content) {
      result.push({ type: "text", value: run.value });
      continue;
    }

    const runSchedules = run.indexes.map((index) => schedules[index]);
    const scheduled = runSchedules.filter(
      (schedule): schedule is ScheduledUnit => schedule !== undefined,
    );
    if (scheduled.length === 0) {
      continue;
    }

    if (state.reveal === "word") {
      const schedule = scheduled[0];
      if (!schedule || scheduled.length !== run.indexes.length) {
        continue;
      }
      if (!isVisible(schedule, state.now)) {
        if (retainPending) {
          result.push({
            type: "element",
            tagName: "span",
            properties: pendingTextProperties(schedule),
            children: [{ type: "text", value: run.value }],
          });
        }
        continue;
      }
      if (scheduled.every((unit) => state.compactedUnitIds.has(unit.id))) {
        result.push({ type: "text", value: run.value });
        continue;
      }
      result.push({
        type: "element",
        tagName: "span",
        properties: {
          ...(isAnimating(schedule, state.now)
            ? activeProperties({}, schedule, "text")
            : retainedTextProperties(schedule)),
          "data-smoothstream-word": true,
        },
        children: [{ type: "text", value: run.value }],
      });
      continue;
    }

    const hasVisibleCharacter = scheduled.some((schedule) =>
      isVisible(schedule, state.now)
    );
    if (!hasVisibleCharacter && !retainPending) {
      continue;
    }

    const children: ElementContent[] = [];
    let remainder = "";
    run.indexes.forEach((index, runIndex) => {
      const segment = prepared.segments[index];
      const schedule = runSchedules[runIndex];
      if (!segment || !schedule) {
        return;
      }
      if (!isVisible(schedule, state.now)) {
        if (retainPending) {
          children.push({
            type: "element",
            tagName: "span",
            properties: pendingTextProperties(schedule),
            children: [{ type: "text", value: segment.value }],
          });
        } else if (reserveBufferedWords) {
          remainder += segment.value;
        }
        return;
      }
      if (state.compactedUnitIds.has(schedule.id)) {
        children.push({ type: "text", value: segment.value });
        return;
      }
      children.push({
        type: "element",
        tagName: "span",
        properties: isAnimating(schedule, state.now)
          ? activeProperties({}, schedule, "text")
          : retainedTextProperties(schedule),
        children: [{ type: "text", value: segment.value }],
      });
    });

    if (reserveBufferedWords && remainder.length > 0) {
      const finalChildIndex = children.length - 1;
      const finalChild = children[finalChildIndex];
      if (finalChild?.type === "element") {
        children[finalChildIndex] = {
          ...finalChild,
          properties: {
            ...finalChild.properties,
            "data-smoothstream-remainder": remainder,
          },
        };
      }
    }
    result.push(...children);
  }

  return result;
};

const transformCodeText = (
  node: Text,
  blockStart: number,
  state: RenderState,
): ElementContent[] => {
  const prepared = prepareCodeText(node, blockStart, state.cache);
  const resolved = resolvedCodeText(node, blockStart, state);
  const highlight = state.codeHighlights.get(blockStart);
  const result: ElementContent[] = [];
  if (
    resolved.lines.length > 0 &&
    resolved.lines.every(
      (line) =>
        line.schedule !== undefined &&
        state.compactedUnitIds.has(line.schedule.id),
    ) &&
    !highlight
  ) {
    return [node];
  }

  prepared.lines.forEach((line, lineIndex) => {
    const resolvedLine = resolved.lines[lineIndex];
    const lineSchedule = resolvedLine?.schedule;
    if (!lineSchedule || !isVisible(lineSchedule, state.now)) {
      return;
    }

    const renderCharacter = (
      character: PreparedCodeCharacter,
      characterIndex: number,
    ): ElementContent | undefined => {
      const schedule = resolvedLine.characterSchedules[characterIndex];
      if (!schedule || !isVisible(schedule, state.now)) {
        return undefined;
      }

      if (state.compactedUnitIds.has(schedule.id)) {
        return { type: "text", value: character.value };
      }

      return {
        type: "element",
        tagName: "span",
        properties: isAnimating(schedule, state.now)
          ? activeProperties({}, schedule, "text")
          : retainedTextProperties(schedule),
        children: [{ type: "text", value: character.value }],
      };
    };

    const highlightedChildren = (
      highlightedLine: CodeHighlightLine,
    ): ElementContent[] => {
      const children: ElementContent[] = [];
      let characterIndex = 0;
      let tokenStart = 0;

      highlightedLine.tokens.forEach((token, tokenIndex) => {
        const tokenEnd = tokenStart + token.content.length;
        const tokenChildren: ElementContent[] = [];
        while (
          characterIndex < line.characters.length &&
          (line.characters[characterIndex]?.start ?? Number.POSITIVE_INFINITY) < tokenEnd
        ) {
          const character = line.characters[characterIndex];
          if (character && character.end > tokenStart) {
            const rendered = renderCharacter(character, characterIndex);
            if (rendered) {
              tokenChildren.push(rendered);
            }
          }
          characterIndex += 1;
        }
        tokenStart = tokenEnd;

        if (tokenChildren.length === 0) {
          return;
        }
        children.push({
          type: "element",
          tagName: "span",
          properties: {
            "data-smoothstream-code-token": `${blockStart}:${lineIndex}:${tokenIndex}`,
            ...(token.style && Object.keys(token.style).length > 0
              ? { style: runtimeStyle({ ...token.style }) }
              : {}),
          },
          children: tokenChildren,
        });
      });
      return children;
    };

    const highlightedLine = highlight?.lines[lineIndex];
    const children = highlightedLine
      ? highlightedChildren(highlightedLine)
      : line.characters.flatMap((character, characterIndex) => {
          const rendered = renderCharacter(character, characterIndex);
          return rendered ? [rendered] : [];
        });
    const lineCompacted = state.compactedUnitIds.has(lineSchedule.id);

    result.push({
      type: "element",
      tagName: "span",
      properties: lineCompacted
        ? { "data-smoothstream-code-line": true }
        : {
            "data-smoothstream-code-line": true,
            "data-smoothstream-state": isAnimating(lineSchedule, state.now)
              ? "active"
              : "settled",
            "data-smoothstream-unit": lineSchedule.id,
          },
      children,
    });
    result.push({ type: "text", value: "\n" });
  });

  return result;
};

const hasRenderedContent = (children: ReadonlyArray<ElementContent>): boolean =>
  children.some(
    (child) => child.type === "element" || (child.type === "text" && /\S/u.test(child.value)),
  );

const inlineCharacterSchedules = (
  node: Element,
  state: RenderState,
): ScheduledUnit[] => {
  const result: ScheduledUnit[] = [];
  const visit = (child: ElementContent): void => {
    if (child.type === "text") {
      const prepared = prepareText(child, state.cache);
      const schedules = resolvedTextSchedules(child, state);
      for (const index of prepared.contentIndexes) {
        const schedule = schedules[index];
        if (schedule) {
          result.push(schedule);
        }
      }
      return;
    }
    if (child.type === "element") {
      child.children.forEach(visit);
    }
  };
  node.children.forEach(visit);
  return result;
};

const inlineContentIsSettled = (
  node: Element,
  state: RenderState,
  fallbackSchedule: ScheduledUnit,
): boolean => {
  let foundScheduledContent = false;
  let settled = true;
  const visit = (child: ElementContent): void => {
    if (child.type === "text") {
      const prepared = prepareText(child, state.cache);
      const schedules = resolvedTextSchedules(child, state);
      for (const index of prepared.contentIndexes) {
        const schedule = schedules[index];
        if (schedule) {
          foundScheduledContent = true;
          settled &&= state.now >= schedule.endAt;
        }
      }
      return;
    }
    if (child.type !== "element") {
      return;
    }
    if (child.tagName === "img") {
      const range = nodeRange(child);
      const schedule = range
        ? state.schedules.get(createRangeUnitId("image", range))
        : undefined;
      if (schedule) {
        foundScheduledContent = true;
        const readiness = state.images.get(schedule.id);
        settled &&=
          readiness !== undefined &&
          state.now >= readinessSchedule(schedule, readiness).endAt;
      }
      return;
    }
    child.children.forEach(visit);
  };
  node.children.forEach(visit);
  return foundScheduledContent ? settled : state.now >= fallbackSchedule.endAt;
};

const firstCharacterSchedule = (
  node: Element,
  state: RenderState,
): ScheduledUnit | undefined => inlineCharacterSchedules(node, state)
  .reduce<ScheduledUnit | undefined>((first, schedule) =>
    first === undefined || schedule.startAt < first.startAt ? schedule : first,
  undefined);

const markerProperties = (
  node: Element,
  state: RenderState,
): Element["properties"] => {
  const schedule = firstCharacterSchedule(node, state);

  return schedule && isAnimating(schedule, state.now)
    ? {
        "data-smoothstream-animation-duration": schedule.duration,
        "data-smoothstream-animation-start": schedule.startAt,
        "data-smoothstream-marker": "active",
      }
    : {};
};

const codePaletteProperties = (
  node: Element,
  state: RenderState,
): Element["properties"] => {
  if (node.tagName !== "pre") {
    return {};
  }
  const blockStart = node.position?.start.offset;
  const highlight = blockStart === undefined
    ? undefined
    : state.codeHighlights.get(blockStart);
  const palette = highlight?.palette;
  const languageLabel = highlight?.languageLabel;
  const hasPalettePresentation = Boolean(
    palette &&
      (palette.backgroundColor ||
        palette.color ||
        (palette.style && Object.keys(palette.style).length > 0)),
  );
  if (!languageLabel && !hasPalettePresentation) {
    return {};
  }

  return {
    ...(languageLabel
      ? {
          "data-smoothstream-code-copy-ready": blockStart !== undefined &&
            state.compactedBlockIds?.has(`block:${blockStart}`) === true,
          "data-smoothstream-code-label": languageLabel,
        }
      : {}),
    ...(hasPalettePresentation && palette
      ? {
          "data-smoothstream-code-theme": true,
          style: runtimeStyle({
            ...palette.style,
            ...(palette.backgroundColor
              ? { "--smoothstream-shiki-background": palette.backgroundColor }
              : {}),
            ...(palette.color
              ? { "--smoothstream-shiki-color": palette.color }
              : {}),
          }),
        }
      : {}),
  };
};

const isTaskCheckbox = (node: ElementContent): node is Element =>
  node.type === "element" &&
  node.tagName === "input" &&
  node.properties?.type === "checkbox";

const taskListChildren = (
  node: Element,
  children: ElementContent[],
  state: RenderState,
): ElementContent[] => {
  if (!node.children.some(isTaskCheckbox)) {
    return children;
  }

  const schedule = firstCharacterSchedule(node, state);
  const result: ElementContent[] = [];
  for (const child of children) {
    if (!isTaskCheckbox(child)) {
      result.push(child);
      continue;
    }
    if (!schedule || !isVisible(schedule, state.now)) {
      continue;
    }
    if (!isAnimating(schedule, state.now)) {
      result.push(child);
      continue;
    }
    result.push({
      ...child,
      properties: {
        ...child.properties,
        "data-smoothstream-animation-duration": schedule.duration,
        "data-smoothstream-animation-start": schedule.startAt,
        "data-smoothstream-task": "active",
      },
    });
  }
  return result;
};

const inlineGroupProperties = (
  node: Element,
  schedule: ScheduledUnit,
  state: RenderState,
): Element["properties"] => {
  const contentIsSettled = inlineContentIsSettled(node, state, schedule);
  const properties: Element["properties"] = {
    ...node.properties,
    "data-smoothstream-state": contentIsSettled ? "settled" : "active",
    "data-smoothstream-unit": schedule.id,
  };

  if (node.tagName === "a" && !contentIsSettled) {
    delete properties.href;
    delete properties.title;
    properties["aria-disabled"] = true;
    properties.tabIndex = -1;
  }
  return properties;
};

const transformImage = (
  node: Element,
  schedule: ScheduledUnit,
  state: RenderState,
  standalone: boolean,
): ElementContent[] => {
  const imageProperties: Element["properties"] = standalone
    ? {
        ...node.properties,
        "data-smoothstream-image-standalone": true,
      }
    : node.properties;
  const readiness = state.images.get(schedule.id);
  if (!readiness) {
    if (!isVisible(schedule, state.now)) {
      return [];
    }

    return [{
      ...node,
      properties: {
        ...imageProperties,
        "aria-hidden": true,
        "data-smoothstream-image": "pending",
        "data-smoothstream-state": "pending",
        "data-smoothstream-unit": schedule.id,
        decoding: "async",
        style: runtimeStyle({
          ...(standalone ? { display: "block" } : {}),
          visibility: "hidden",
        }),
      },
    }];
  }

  const effectiveSchedule = readinessSchedule(schedule, readiness);
  if (!isVisible(effectiveSchedule, state.now)) {
    return [];
  }
  if (
    state.compactedUnitIds.has(schedule.id) &&
    state.now >= effectiveSchedule.endAt
  ) {
    return [{
      ...node,
      properties: imageProperties,
    }];
  }

  const intrinsicProperties: Element["properties"] =
    readiness.status === "ready" &&
    readiness.width !== undefined &&
    readiness.height !== undefined
      ? { height: readiness.height, width: readiness.width }
      : {};
  const properties = {
    ...imageProperties,
    ...intrinsicProperties,
    "data-smoothstream-image": readiness.status,
    decoding: "async",
  };

  return [{
    ...node,
    properties: isAnimating(effectiveSchedule, state.now)
      ? activeProperties(properties, effectiveSchedule, "image")
      : retainedElementProperties(properties, effectiveSchedule),
  }];
};

const transformNode = (
  node: ElementContent,
  state: RenderState,
  insidePre = false,
  codeBlockStart?: number,
  retainPendingText = false,
  standaloneImage = false,
  reserveBufferedWords = true,
): ElementContent[] => {
  if (node.type === "text") {
    return codeBlockStart === undefined
      ? transformText(
          node,
          state,
          retainPendingText,
          reserveBufferedWords,
        )
      : transformCodeText(node, codeBlockStart, state);
  }

  if (node.type !== "element") {
    return [node];
  }

  if (node.tagName === "table" && !hasVisibleTableRow(node, state)) {
    return [];
  }

  const kind = elementRevealKind(node, insidePre);
  const range = nodeRange(node);
  if (kind && range) {
    const schedule = state.schedules.get(createRangeUnitId(kind, range));
    if (!schedule) {
      return [];
    }

    if (kind === "image") {
      return transformImage(node, schedule, state, standaloneImage);
    }

    if (!isVisible(schedule, state.now)) {
      if (
        retainPendingText &&
        (kind === "inline" || kind === "link") &&
        INLINE_GROUP_TAGS.has(node.tagName)
      ) {
        return [{
          ...node,
          properties: pendingInlineGroupProperties(node.properties, schedule),
        }];
      }

      return kind === "table-row"
        ? [{
            ...node,
            properties: pendingTableRowProperties(node.properties, schedule),
          }]
        : [];
    }

    if (
      state.compactedUnitIds.has(schedule.id) &&
      !(
        kind === "link" &&
        !inlineContentIsSettled(node, state, schedule)
      )
    ) {
      return [node];
    }

    if (
      (kind === "inline" || kind === "link") &&
      INLINE_GROUP_TAGS.has(node.tagName)
    ) {
      const children = node.children.flatMap((child) =>
        transformNode(
          child,
          state,
          insidePre,
          codeBlockStart,
          retainPendingText,
          false,
          reserveBufferedWords && node.tagName !== "code",
        ),
      );
      if (!hasRenderedContent(children)) {
        return [];
      }
      return [{
        ...node,
        properties: inlineGroupProperties(node, schedule, state),
        children,
      }];
    }

    const properties = isAnimating(schedule, state.now)
      ? activeProperties(node.properties, schedule, kind)
      : kind === "table-row"
        ? {
            ...activeProperties(node.properties, schedule, kind),
            "data-smoothstream-state": "settled",
          }
        : retainedElementProperties(node.properties, schedule);

    if (kind === "table-row") {
      return [{
        ...node,
        properties,
        children: node.children.flatMap((child) =>
          transformNode(
            child,
            state,
            insidePre,
            codeBlockStart,
            true,
          ),
        ),
      }];
    }

    return [{
      ...node,
      properties,
    }];
  }

  const nextInsidePre = insidePre || node.tagName === "pre";
  const nextCodeBlockStart =
    node.tagName === "pre" ? range?.start : codeBlockStart;
  const meaningfulChildren = node.children.filter(
    (child) => child.type !== "text" || /\S/u.test(child.value),
  );
  const standaloneImageChild =
    node.tagName === "p" &&
    meaningfulChildren.length === 1 &&
    meaningfulChildren[0]?.type === "element" &&
    meaningfulChildren[0].tagName === "img"
      ? meaningfulChildren[0]
      : undefined;
  const transformedChildren: ElementContent[] = [];
  for (const child of node.children) {
    const childIsImage = child.type === "element" && child.tagName === "img";
    transformedChildren.push(
      ...transformNode(
        child,
        state,
        nextInsidePre,
        nextCodeBlockStart,
        retainPendingText,
        child === standaloneImageChild,
        reserveBufferedWords,
      ),
    );

    if (node.tagName !== "p" || !childIsImage || standaloneImageChild) {
      continue;
    }
    const childRange = nodeRange(child);
    const childSchedule = childRange
      ? state.schedules.get(createRangeUnitId("image", childRange))
      : undefined;
    if (childSchedule && !state.images.has(childSchedule.id)) {
      break;
    }
  }
  const children = node.tagName === "li"
    ? taskListChildren(node, transformedChildren, state)
    : transformedChildren;

  if (PRUNABLE_CONTAINERS.has(node.tagName) && !hasRenderedContent(children)) {
    return [];
  }

  return [{
    ...node,
    properties: {
      ...node.properties,
      ...(node.tagName === "li" ? markerProperties(node, state) : {}),
      ...codePaletteProperties(node, state),
    },
    children,
  }];
};

const transformRootNode = (
  node: RootContent,
  state: RenderState,
): RootContent[] =>
  node.type === "doctype" ? [node] : transformNode(node, state);

const stableKey = (
  props: Record<string, unknown> | null,
  fallback: Key | undefined,
): Key | undefined => {
  const unitId = props?.["data-smoothstream-unit"];
  // Inline groups and images keep their tree-position identity so removing
  // reveal props at settlement does not replace the underlying DOM node.
  if (
    typeof unitId === "string" &&
    ["image:", "inline:", "link:"].some((prefix) =>
      unitId.startsWith(prefix)
    )
  ) {
    return fallback;
  }
  return typeof unitId === "string" ? unitId : fallback;
};

const keyedJsx: typeof jsx = (type, props, key) =>
  jsx(
    type,
    props,
    stableKey(props as Record<string, unknown> | null, key),
  );

const keyedJsxs: typeof jsxs = (type, props, key) =>
  jsxs(
    type,
    props,
    stableKey(props as Record<string, unknown> | null, key),
  );

interface ReactPropertyInfo {
  readonly commaSeparated: boolean;
  readonly name: string;
}

const reactPropertyInfoByName = new Map<string, ReactPropertyInfo>();
const tableContainers = new Set(["table", "tbody", "tfoot", "thead", "tr"]);
const tableCells = new Set(["td", "th"]);

const reactPropertyInfo = (property: string): ReactPropertyInfo => {
  const cached = reactPropertyInfoByName.get(property);
  if (cached) {
    return cached;
  }

  const information = find(html, property);
  const result = {
    commaSeparated: information.commaSeparated,
    name: information.space
      ? hastToReact[information.property] ?? information.property
      : information.attribute,
  };
  reactPropertyInfoByName.set(property, result);
  return result;
};

const reactElementProperties = (
  node: Element,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  let tableCellAlign: string | undefined;

  for (const [property, originalValue] of Object.entries(node.properties)) {
    if (
      property === "children" ||
      originalValue === null ||
      originalValue === undefined ||
      (typeof originalValue === "number" && Number.isNaN(originalValue))
    ) {
      continue;
    }

    const information = reactPropertyInfo(property);
    const value = Array.isArray(originalValue)
      ? originalValue
        .join(information.commaSeparated ? ", " : " ")
        .trim()
      : originalValue;
    if (
      information.name === "align" &&
      typeof value === "string" &&
      tableCells.has(node.tagName)
    ) {
      tableCellAlign = value;
    } else {
      result[information.name] = value;
    }
  }

  if (tableCellAlign) {
    result.style = {
      ...(typeof result.style === "object" ? result.style : {}),
      textAlign: tableCellAlign,
    };
  }
  return result;
};

const hastChildrenToReact = (
  children: ReadonlyArray<RootContent>,
  filterTableWhitespace: boolean,
): ReactNode[] => {
  const result: ReactNode[] = [];
  const countsByTag = new Map<string, number>();

  for (const child of children) {
    let fallbackKey: string | undefined;
    if (child.type === "element") {
      const count = countsByTag.get(child.tagName) ?? 0;
      fallbackKey = `${child.tagName}-${count}`;
      countsByTag.set(child.tagName, count + 1);
    }

    const rendered = hastNodeToReact(child, fallbackKey);
    if (
      rendered !== undefined &&
      !(filterTableWhitespace &&
        typeof rendered === "string" &&
        /^\s*$/u.test(rendered))
    ) {
      result.push(rendered);
    }
  }
  return result;
};

const elementTextContent = (node: ElementContent): string => {
  if (node.type === "text") {
    return node.value;
  }
  return node.type === "element"
    ? node.children.map(elementTextContent).join("")
    : "";
};

const codeBlockValue = (node: Element): string => {
  const code = node.children.find(
    (child): child is Element =>
      child.type === "element" && child.tagName === "code",
  );
  const value = code ? elementTextContent(code) : node.children
    .map(elementTextContent)
    .join("");
  return value.endsWith("\n") ? value.slice(0, -1) : value;
};

const hastNodeToReact = (
  node: RootContent,
  fallbackKey?: string,
): ReactNode | undefined => {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type !== "element") {
    return undefined;
  }

  const properties = reactElementProperties(node);
  const children = hastChildrenToReact(
    node.children,
    tableContainers.has(node.tagName),
  );
  const childValue = children.length > 1 ? children : children[0];
  if (childValue) {
    properties.children = childValue;
  }

  const type = node.tagName as Parameters<typeof jsx>[0];
  const element = children.length > 1
    ? keyedJsxs(type, properties, fallbackKey)
    : keyedJsx(type, properties, fallbackKey);
  if (node.tagName === "table") {
    return keyedJsx("div", {
      "data-smoothstream-table-shell": true,
      children: jsx("div", {
        "data-smoothstream-table-scroll": true,
        children: element,
      }),
    }, fallbackKey);
  }
  const label = node.tagName === "pre" &&
      typeof node.properties["data-smoothstream-code-label"] === "string"
    ? node.properties["data-smoothstream-code-label"]
    : undefined;
  if (!label) {
    return element;
  }

  const copyReady = node.properties["data-smoothstream-code-copy-ready"] ===
    true;
  return keyedJsx(EnhancedCodeBlock, {
    code: codeBlockValue(node),
    content: childValue,
    copyReady,
    label,
    properties,
  }, fallbackKey);
};

const hastRootToReact = (tree: Root): ReactNode => {
  const children = hastChildrenToReact(tree.children, false);
  const properties: Record<string, unknown> = {};
  const childValue = children.length > 1 ? children : children[0];
  if (childValue) {
    properties.children = childValue;
  }
  return children.length > 1
    ? keyedJsxs(Fragment, properties)
    : keyedJsx(Fragment, properties);
};

const rootContentRange = (node: RootContent): SourceRange | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { end, start };
};

interface FingerprintState {
  first: number;
  second: number;
  size: number;
}

const appendFingerprint = (
  state: FingerprintState,
  value: string,
): void => {
  state.size += value.length;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    state.first = Math.imul(state.first ^ code, 16_777_619);
    state.second = Math.imul(state.second ^ code, 2_246_822_519);
  }
};

const fingerprintValue = (
  value: unknown,
  state: FingerprintState,
): void => {
  if (value === null) {
    appendFingerprint(state, "null;");
    return;
  }
  if (Array.isArray(value)) {
    appendFingerprint(state, "[");
    value.forEach((item) => fingerprintValue(item, state));
    appendFingerprint(state, "]");
    return;
  }
  if (typeof value === "object") {
    appendFingerprint(state, "{");
    for (const key of Object.keys(value).sort()) {
      appendFingerprint(state, `${key}:`);
      fingerprintValue((value as Record<string, unknown>)[key], state);
    }
    appendFingerprint(state, "}");
    return;
  }
  appendFingerprint(state, `${typeof value}:${String(value)};`);
};

const nodeFingerprint = (node: RootContent): string => {
  const state: FingerprintState = {
    first: 2_166_136_261,
    second: 3_332_006_821,
    size: 0,
  };
  fingerprintValue(node, state);
  return `${state.first >>> 0}:${state.second >>> 0}:${state.size}`;
};

const prepareRenderBlocks = (
  tree: Root,
  units: ReadonlyArray<MarkdownRevealUnit>,
  cache: HastRenderCache,
): ReadonlyArray<HastRenderBlock> => {
  const cached = cache.blocksByRoot.get(tree);
  if (cached) {
    return cached;
  }

  const blocks = tree.children.map((node, index): HastRenderBlock => {
    const range = rootContentRange(node);
    const blockUnits = range
      ? units.filter(
          (unit) =>
            unit.sourceRange.start >= range.start &&
            unit.sourceRange.end <= range.end,
        )
      : [];
    return {
      blockIds: [...new Set(blockUnits.map((unit) => unit.blockId))],
      fingerprint: nodeFingerprint(node),
      imageUnits: blockUnits.filter((unit) => unit.kind === "image"),
      key: `${
        node.type === "element" ? node.tagName : node.type
      }:${range?.start ?? "unpositioned"}:${index}`,
      node,
      unitSignature: blockUnits.map((unit) => unit.id).join(","),
      units: blockUnits,
    };
  });
  cache.blocksByRoot.set(tree, blocks);
  return blocks;
};

const prepareBlockTimings = (
  tree: Root,
  blocks: ReadonlyArray<HastRenderBlock>,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  cache: HastRenderCache,
): ReadonlyMap<string, HastBlockTiming> => {
  let timingsBySchedules = cache.blockTimingsByRoot.get(tree);
  if (!timingsBySchedules) {
    timingsBySchedules = new WeakMap();
    cache.blockTimingsByRoot.set(tree, timingsBySchedules);
  }
  const cached = timingsBySchedules.get(schedules);
  if (cached) {
    return cached;
  }

  const timings = new Map<string, HastBlockTiming>();
  for (const block of blocks) {
    const startTimes: number[] = [];
    const endTimes: number[] = [];
    for (const unit of block.units) {
      const schedule = schedules.get(unit.id);
      if (schedule) {
        startTimes.push(schedule.startAt);
        endTimes.push(schedule.endAt);
      }
    }
    startTimes.sort((left, right) => left - right);
    endTimes.sort((left, right) => left - right);
    timings.set(block.key, { endTimes, startTimes });
  }

  timingsBySchedules.set(schedules, timings);
  return timings;
};

const countThrough = (
  times: ReadonlyArray<number>,
  now: number,
): number => {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((times[middle] ?? Number.POSITIVE_INFINITY) <= now) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const blockRenderRevision = (
  block: HastRenderBlock,
  timing: HastBlockTiming,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  now: number,
  compactedUnitIds: CompactedUnitLookup,
  compactedBlockIds: ReadonlySet<string> | undefined,
  images: ReadonlyMap<string, ImageReadiness>,
  visibleUnitCount: number,
  codeHighlightRevision: number,
): string => {
  const imageStates: string[] = [];

  for (const unit of block.imageUnits) {
    const schedule = schedules.get(unit.id);
    if (!schedule) {
      continue;
    }
    const readiness = images.get(unit.id);
    if (!readiness) {
      imageStates.push(`${unit.id}:unresolved`);
      continue;
    }
    const effectiveSchedule = readinessSchedule(schedule, readiness);
    const phase = now < effectiveSchedule.startAt
      ? "pending"
      : now < effectiveSchedule.endAt
        ? "active"
        : "settled";
    imageStates.push(
      [
        unit.id,
        readiness.status,
        readiness.readyAt,
        readiness.width ?? "auto",
        readiness.height ?? "auto",
        phase,
      ].join(":"),
    );
  }

  const imageFollowingRevision = imageStates.length > 0
    ? visibleUnitCount
    : "none";
  const compactionRevision = compactedBlockIds
    ? block.blockIds.map((blockId) =>
        compactedBlockIds.has(blockId) ? "1" : "0"
      ).join("")
    : block.units.reduce(
        (count, unit) => count + Number(compactedUnitIds.has(unit.id)),
        0,
      );
  return [
    block.fingerprint,
    block.unitSignature,
    timing.startTimes.length,
    countThrough(timing.startTimes, now),
    countThrough(timing.endTimes, now),
    compactionRevision,
    imageFollowingRevision,
    imageStates.join(","),
    codeHighlightRevision,
  ].join("|");
};

interface HastBlockProps {
  readonly cache: HastRenderCache;
  readonly codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  readonly compactedBlockIds: ReadonlySet<string> | undefined;
  readonly compactedUnitIds: CompactedUnitLookup;
  readonly images: ReadonlyMap<string, ImageReadiness>;
  readonly node: RootContent;
  readonly now: number;
  readonly reveal: MarkdownReveal;
  readonly revision: string;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
}

const HastBlock = ({
  cache,
  codeHighlights,
  compactedBlockIds,
  compactedUnitIds,
  images,
  node,
  now,
  reveal,
  schedules,
}: HastBlockProps): ReactNode => {
  const transformed: Root = {
    type: "root",
    children: transformRootNode(node, {
      cache,
      codeHighlights,
      compactedBlockIds,
      compactedUnitIds,
      images,
      now,
      reveal,
      schedules,
    }),
  };
  return hastRootToReact(transformed);
};

const MemoizedHastBlock = memo(
  HastBlock,
  (previous, next) => previous.revision === next.revision,
);

export const renderHast = (
  tree: Root,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  now: number,
  compactedUnitIds: CompactedUnitLookup,
  images: ReadonlyMap<string, ImageReadiness>,
  cache = createHastRenderCache(),
  visibleUnitCount = 0,
  units: ReadonlyArray<MarkdownRevealUnit> = [],
  compactedBlockIds?: ReadonlySet<string>,
  codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight> = new Map(),
  codeHighlightRevision = 0,
  reveal: MarkdownReveal = "character",
): ReactNode => {
  const blocks = prepareRenderBlocks(tree, units, cache);
  const timings = prepareBlockTimings(tree, blocks, schedules, cache);
  return blocks.map((block) =>
    createElement(MemoizedHastBlock, {
      cache,
      codeHighlights,
      compactedBlockIds,
      compactedUnitIds,
      images,
      key: block.key,
      node: block.node,
      now,
      reveal,
      revision: blockRenderRevision(
        block,
        timings.get(block.key) ?? { endTimes: [], startTimes: [] },
        schedules,
        now,
        compactedUnitIds,
        compactedBlockIds,
        images,
        visibleUnitCount,
        codeHighlightRevision,
      ) + `|${reveal}`,
      schedules,
    })
  );
};
