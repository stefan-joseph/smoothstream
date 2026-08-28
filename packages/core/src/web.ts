import type {
  Element as HastElement,
  ElementContent,
  Root,
  RootContent,
  Text,
} from "hast";
import {
  createCodeCharacterUnitId,
  createCodeLineUnitId,
  createRangeUnitId,
} from "./markdown/identity";
import {
  segmentGraphemes,
  type GraphemeSegment,
} from "./markdown/graphemes";
import type {
  MarkdownReveal,
  MarkdownRevealKind,
  MarkdownRevealUnit,
  SourceRange,
} from "./markdown/types";
import type { CodeHighlightLine } from "./code-types";
import type { ResolvedCodeHighlight } from "./code-highlighting";
import type { ImageReadiness } from "./images";
import type { ScheduledUnit } from "./types";

export type WebProperties = Readonly<Record<string, unknown>>;

export interface WebTextNode {
  readonly key: string;
  readonly type: "text";
  readonly value: string;
}

export interface WebElementNode {
  readonly children: ReadonlyArray<WebRenderNode>;
  readonly key: string;
  readonly namespace?: "svg";
  readonly properties: WebProperties;
  readonly tagName: string;
  readonly type: "element";
}

export type WebRenderNode = WebElementNode | WebTextNode;

export interface WebCompactedUnitLookup {
  has(unitId: string): boolean;
}

interface ResolvedCodeSchedules {
  readonly blockStart: number;
  readonly characters: ReadonlyArray<
    ReadonlyArray<ScheduledUnit | undefined>
  >;
  readonly lines: ReadonlyArray<ScheduledUnit | undefined>;
}

export interface WebPresentationCache {
  readonly codeSchedulesBySnapshot: WeakMap<
    ReadonlyMap<string, ScheduledUnit>,
    WeakMap<Text, ResolvedCodeSchedules>
  >;
  readonly graphemesByValue: Map<string, ReadonlyArray<GraphemeSegment>>;
  readonly textSchedulesBySnapshot: WeakMap<
    ReadonlyMap<string, ScheduledUnit>,
    WeakMap<Text, ReadonlyArray<ScheduledUnit | undefined>>
  >;
}

export const createWebPresentationCache = (): WebPresentationCache => ({
  codeSchedulesBySnapshot: new WeakMap(),
  graphemesByValue: new Map(),
  textSchedulesBySnapshot: new WeakMap(),
});

export interface WebPresentationState {
  readonly cache?: WebPresentationCache;
  readonly codeHighlighterEnabled: boolean;
  readonly codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  readonly compactedBlockIds: ReadonlySet<string>;
  readonly compactedUnitIds: WebCompactedUnitLookup;
  readonly images: ReadonlyMap<string, ImageReadiness>;
  readonly immediate: boolean;
  readonly now: number;
  readonly reveal: MarkdownReveal;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
  /** Whether code-block language labels are enabled. @default true */
  readonly showLanguageLabels?: boolean;
  readonly tree: Root;
  readonly units: ReadonlyArray<MarkdownRevealUnit>;
}

const PRUNABLE_CONTAINERS = new Set([
  "a", "blockquote", "code", "del", "em", "h1", "h2", "h3", "h4",
  "h5", "h6", "li", "ol", "p", "pre", "strong", "table", "tbody",
  "thead", "ul",
]);
const INLINE_GROUP_TAGS = new Set(["a", "code", "del", "em", "strong"]);

const textSpec = (key: string, value: string): WebTextNode => ({
  key,
  type: "text",
  value,
});

const elementSpec = (
  key: string,
  tagName: string,
  properties: WebProperties,
  children: ReadonlyArray<WebRenderNode>,
  namespace?: "svg",
): WebElementNode => ({
  children,
  key,
  ...(namespace ? { namespace } : {}),
  properties,
  tagName,
  type: "element",
});

const nodeRange = (node: HastElement | Text): SourceRange | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { end, start };
};

const nodeKey = (node: HastElement | Text, path: string): string =>
  `${node.type}:${node.type === "element" ? node.tagName : "text"}:${node.position?.start.offset ?? path}:${path}`;

const isVisible = (schedule: ScheduledUnit, now: number): boolean =>
  schedule.startAt <= now;

const isAnimating = (schedule: ScheduledUnit, now: number): boolean =>
  isVisible(schedule, now) && now < schedule.endAt;

const styleWith = (
  original: unknown,
  additions: Readonly<Record<string, number | string>>,
): Readonly<Record<string, number | string>> => ({
  ...(typeof original === "object" && original !== null
    ? original as Record<string, number | string>
    : {}),
  ...additions,
});

const activeWebProperties = (
  properties: WebProperties,
  schedule: ScheduledUnit,
  kind: MarkdownRevealKind,
  now: number,
): WebProperties => ({
  ...properties,
  "data-smoothstream-animation-duration": schedule.duration,
  "data-smoothstream-animation-start": schedule.startAt,
  "data-smoothstream-kind": kind,
  "data-smoothstream-unit": schedule.id,
  style: styleWith(properties.style, {
    "--smoothstream-animation-delay": `${Math.min(0, schedule.startAt - now)}ms`,
    "--smoothstream-duration": `${schedule.duration}ms`,
  }),
});

const retainedWebProperties = (
  properties: WebProperties,
  schedule: ScheduledUnit,
): WebProperties => ({
  ...properties,
  "data-smoothstream-state": "settled",
  "data-smoothstream-unit": schedule.id,
});

const pendingWebProperties = (schedule: ScheduledUnit): WebProperties => ({
  "aria-hidden": true,
  "data-smoothstream-state": "pending",
  "data-smoothstream-unit": schedule.id,
  style: { visibility: "hidden" },
});

const elementRevealKind = (
  node: HastElement,
  insidePre: boolean,
): MarkdownRevealKind | undefined => {
  if (node.tagName === "tr") return "table-row";
  if (node.tagName === "img") return "image";
  if (node.tagName === "a" && !insidePre) return "link";
  if (INLINE_GROUP_TAGS.has(node.tagName) && !insidePre) return "inline";
  return node.tagName === "hr" ? "block" : undefined;
};

const schedulesInside = (
  range: SourceRange,
  state: WebPresentationState,
): ScheduledUnit[] => state.units.flatMap((unit) => {
  if (
    unit.sourceRange.start < range.start ||
    unit.sourceRange.end > range.end
  ) {
    return [];
  }
  const schedule = state.schedules.get(unit.id);
  return schedule ? [schedule] : [];
});

const firstScheduleInside = (
  node: HastElement,
  state: WebPresentationState,
): ScheduledUnit | undefined => {
  const range = nodeRange(node);
  return range
    ? schedulesInside(range, state).reduce<ScheduledUnit | undefined>(
        (first, schedule) =>
          first === undefined || schedule.startAt < first.startAt
            ? schedule
            : first,
        undefined,
      )
    : undefined;
};

const hasVisibleTableRow = (
  node: HastElement,
  state: WebPresentationState,
): boolean => {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "tr") {
      const range = nodeRange(child);
      const schedule = range
        ? state.schedules.get(createRangeUnitId("table-row", range))
        : undefined;
      if (schedule && isVisible(schedule, state.now)) return true;
    } else if (hasVisibleTableRow(child, state)) {
      return true;
    }
  }
  return false;
};

const hasRenderedContent = (children: ReadonlyArray<WebRenderNode>): boolean =>
  children.some((child) => child.type === "element" || /\S/u.test(child.value));

const cachedGraphemes = (
  value: string,
  cache: WebPresentationCache | undefined,
): ReadonlyArray<GraphemeSegment> => {
  const cached = cache?.graphemesByValue.get(value);
  if (cached) return cached;
  const segments = segmentGraphemes(value);
  cache?.graphemesByValue.set(value, segments);
  return segments;
};

const resolvedTextSchedules = (
  node: Text,
  range: SourceRange,
  segments: ReadonlyArray<GraphemeSegment>,
  state: WebPresentationState,
): ReadonlyArray<ScheduledUnit | undefined> => {
  const cache = state.cache;
  let schedulesByNode = cache?.textSchedulesBySnapshot.get(state.schedules);
  if (cache && !schedulesByNode) {
    schedulesByNode = new WeakMap();
    cache.textSchedulesBySnapshot.set(state.schedules, schedulesByNode);
  }
  const cached = schedulesByNode?.get(node);
  if (cached) return cached;
  const schedules = segments.map((segment) =>
    /\S/u.test(segment.value)
      ? state.schedules.get(createRangeUnitId("text", {
          end: range.start + segment.end,
          start: range.start + segment.start,
        }))
      : undefined
  );
  schedulesByNode?.set(node, schedules);
  return schedules;
};

const resolvedCodeSchedules = (
  node: Text,
  blockStart: number,
  characters: ReadonlyArray<ReadonlyArray<GraphemeSegment>>,
  state: WebPresentationState,
): ResolvedCodeSchedules => {
  const cache = state.cache;
  let schedulesByNode = cache?.codeSchedulesBySnapshot.get(state.schedules);
  if (cache && !schedulesByNode) {
    schedulesByNode = new WeakMap();
    cache.codeSchedulesBySnapshot.set(state.schedules, schedulesByNode);
  }
  const cached = schedulesByNode?.get(node);
  if (cached?.blockStart === blockStart) return cached;
  const resolved: ResolvedCodeSchedules = {
    blockStart,
    characters: characters.map((line, lineIndex) =>
      line.map((_, characterIndex) =>
        state.schedules.get(
          createCodeCharacterUnitId(blockStart, lineIndex, characterIndex),
        )
      )
    ),
    lines: characters.map((_, lineIndex) =>
      state.schedules.get(createCodeLineUnitId(blockStart, lineIndex))
    ),
  };
  schedulesByNode?.set(node, resolved);
  return resolved;
};

const transformText = (
  node: Text,
  state: WebPresentationState,
  path: string,
  retainPending: boolean,
  reserveBufferedWords: boolean,
): WebRenderNode[] => {
  const range = nodeRange(node);
  if (!range) return [textSpec(`${path}:raw`, node.value)];

  const segments = cachedGraphemes(node.value, state.cache);
  const schedules = resolvedTextSchedules(node, range, segments, state);
  const contentIndexes = segments.flatMap((segment, index) =>
    /\S/u.test(segment.value) ? [index] : []
  );
  if (
    contentIndexes.length > 0 &&
    contentIndexes.every((index) => {
      const schedule = schedules[index];
      return schedule && state.compactedUnitIds.has(schedule.id);
    })
  ) {
    return [textSpec(`${nodeKey(node, path)}:compacted`, node.value)];
  }

  const runs: Array<{ content: boolean; indexes: number[]; value: string }> = [];
  segments.forEach((segment, index) => {
    const content = /\S/u.test(segment.value);
    const previous = runs.at(-1);
    if (previous?.content === content) {
      previous.indexes.push(index);
      previous.value += segment.value;
    } else {
      runs.push({ content, indexes: [index], value: segment.value });
    }
  });
  const result: WebRenderNode[] = [];

  runs.forEach((run, runIndex) => {
    if (!run.content) {
      result.push(textSpec(`${nodeKey(node, path)}:space:${runIndex}`, run.value));
      return;
    }
    const runSchedules = run.indexes.map((index) => schedules[index]);
    const scheduled = runSchedules.filter(
      (schedule): schedule is ScheduledUnit => schedule !== undefined,
    );
    if (scheduled.length === 0) return;

    if (state.reveal === "word") {
      const schedule = scheduled[0];
      if (!schedule || scheduled.length !== run.indexes.length) return;
      if (!isVisible(schedule, state.now)) {
        if (retainPending) {
          result.push(elementSpec(
            `unit:${schedule.id}`,
            "span",
            pendingWebProperties(schedule),
            [textSpec(`unit:${schedule.id}:text`, run.value)],
          ));
        }
        return;
      }
      if (scheduled.every((unit) => state.compactedUnitIds.has(unit.id))) {
        result.push(textSpec(`word:${schedule.id}:compacted`, run.value));
        return;
      }
      result.push(elementSpec(
        `unit:${schedule.id}`,
        "span",
        {
          ...(isAnimating(schedule, state.now)
            ? activeWebProperties({}, schedule, "text", state.now)
            : retainedWebProperties({}, schedule)),
          "data-smoothstream-word": true,
        },
        [textSpec(`unit:${schedule.id}:text`, run.value)],
      ));
      return;
    }

    if (!scheduled.some((schedule) => isVisible(schedule, state.now)) && !retainPending) {
      return;
    }
    const children: WebRenderNode[] = [];
    let remainder = "";
    run.indexes.forEach((index, characterIndex) => {
      const segment = segments[index];
      const schedule = runSchedules[characterIndex];
      if (!segment || !schedule) return;
      if (!isVisible(schedule, state.now)) {
        if (retainPending) {
          children.push(elementSpec(
            `unit:${schedule.id}`,
            "span",
            pendingWebProperties(schedule),
            [textSpec(`unit:${schedule.id}:text`, segment.value)],
          ));
        } else if (reserveBufferedWords) {
          remainder += segment.value;
        }
        return;
      }
      if (state.compactedUnitIds.has(schedule.id)) {
        children.push(textSpec(`unit:${schedule.id}:compacted`, segment.value));
        return;
      }
      children.push(elementSpec(
        `unit:${schedule.id}`,
        "span",
        isAnimating(schedule, state.now)
          ? activeWebProperties({}, schedule, "text", state.now)
          : retainedWebProperties({}, schedule),
        [textSpec(`unit:${schedule.id}:text`, segment.value)],
      ));
    });
    if (reserveBufferedWords && remainder.length > 0) {
      const final = children.at(-1);
      if (final?.type === "element") {
        children[children.length - 1] = {
          ...final,
          properties: {
            ...final.properties,
            "data-smoothstream-remainder": remainder,
          },
        };
      }
    }
    result.push(...children);
  });
  return result;
};

const transformCodeText = (
  node: Text,
  blockStart: number,
  state: WebPresentationState,
  path: string,
): WebRenderNode[] => {
  const lines = node.value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const highlight = state.codeHighlights.get(blockStart);
  const charactersByLine = lines.map((line) =>
    cachedGraphemes(line, state.cache)
  );
  const resolvedSchedules = resolvedCodeSchedules(
    node,
    blockStart,
    charactersByLine,
    state,
  );
  const lineSchedules = resolvedSchedules.lines;
  if (
    !highlight &&
    lineSchedules.length > 0 &&
    lineSchedules.every(
      (schedule) => schedule && state.compactedUnitIds.has(schedule.id),
    )
  ) {
    return [textSpec(`${path}:code:compacted`, node.value)];
  }
  const result: WebRenderNode[] = [];
  lines.forEach((line, lineIndex) => {
    const lineSchedule = lineSchedules[lineIndex];
    if (!lineSchedule || !isVisible(lineSchedule, state.now)) return;
    const lineCompacted = state.compactedUnitIds.has(lineSchedule.id);
    const characters = charactersByLine[lineIndex] ?? [];
    const characterSchedules = resolvedSchedules.characters[lineIndex] ?? [];
    const renderCharacter = (
      character: (typeof characters)[number],
      characterIndex: number,
    ): WebRenderNode | undefined => {
      const schedule = characterSchedules[characterIndex];
      if (!schedule || !isVisible(schedule, state.now)) return undefined;
      if (state.compactedUnitIds.has(schedule.id)) {
        return textSpec(`unit:${schedule.id}:compacted`, character.value);
      }
      return elementSpec(
        `unit:${schedule.id}`,
        "span",
        isAnimating(schedule, state.now)
          ? activeWebProperties({}, schedule, "text", state.now)
          : retainedWebProperties({}, schedule),
        [textSpec(`unit:${schedule.id}:text`, character.value)],
      );
    };
    const highlightedChildren = (
      highlightedLine: CodeHighlightLine,
    ): WebRenderNode[] => {
      const children: WebRenderNode[] = [];
      let characterIndex = 0;
      let tokenStart = 0;
      highlightedLine.tokens.forEach((token, tokenIndex) => {
        const tokenEnd = tokenStart + token.content.length;
        const tokenChildren: WebRenderNode[] = [];
        while (
          characterIndex < characters.length &&
          (characters[characterIndex]?.start ?? Number.POSITIVE_INFINITY) < tokenEnd
        ) {
          const character = characters[characterIndex];
          if (character && character.end > tokenStart) {
            const rendered = renderCharacter(character, characterIndex);
            if (rendered) tokenChildren.push(rendered);
          }
          characterIndex += 1;
        }
        tokenStart = tokenEnd;
        if (tokenChildren.length === 0) return;
        children.push(elementSpec(
          `code-token:${blockStart}:${lineIndex}:${tokenIndex}`,
          "span",
          {
            "data-smoothstream-code-token": `${blockStart}:${lineIndex}:${tokenIndex}`,
            ...(token.style && Object.keys(token.style).length > 0
              ? { style: token.style }
              : {}),
          },
          tokenChildren,
        ));
      });
      return children;
    };
    const highlightedLine = highlight?.lines[lineIndex];
    const children = highlightedLine
      ? highlightedChildren(highlightedLine)
      : characters.flatMap((character, characterIndex) => {
          const rendered = renderCharacter(character, characterIndex);
          return rendered ? [rendered] : [];
        });
    result.push(elementSpec(
      `unit:${lineSchedule.id}`,
      "span",
      lineCompacted
        ? { "data-smoothstream-code-line": true }
        : {
            "data-smoothstream-code-line": true,
            "data-smoothstream-state": isAnimating(lineSchedule, state.now)
              ? "active"
              : "settled",
            "data-smoothstream-unit": lineSchedule.id,
          },
      children,
    ));
    result.push(textSpec(`${path}:line-break:${lineIndex}`, "\n"));
  });
  return result;
};

const codeBlockWebProperties = (
  node: HastElement,
  state: WebPresentationState,
  properties: WebProperties,
): WebProperties => {
  if (node.tagName !== "pre") return properties;
  const blockStart = node.position?.start.offset;
  const highlight = blockStart === undefined
    ? undefined
    : state.codeHighlights.get(blockStart);
  const palette = highlight?.palette;
  const languageLabel = state.showLanguageLabels === false
    ? undefined
    : highlight?.languageLabel;
  const paletteStyle = {
    ...palette?.style,
    ...(palette?.backgroundColor
      ? { "--smoothstream-shiki-background": palette.backgroundColor }
      : {}),
    ...(palette?.color
      ? { "--smoothstream-shiki-color": palette.color }
      : {}),
  };

  if (
    !state.codeHighlighterEnabled &&
    !languageLabel &&
    Object.keys(paletteStyle).length === 0
  ) {
    return properties;
  }
  return {
    ...properties,
    "data-smoothstream-code-copy-ready": blockStart !== undefined &&
      state.compactedBlockIds.has(`block:${blockStart}`),
    "data-smoothstream-code-label": languageLabel ?? "",
    ...(state.showLanguageLabels === false
      ? { "data-smoothstream-code-language-hidden": true }
      : {}),
    ...(Object.keys(paletteStyle).length > 0
      ? {
          "data-smoothstream-code-theme": true,
          style: styleWith(properties.style, paletteStyle),
        }
      : {}),
  };
};

const codeIcon = (
  key: string,
  kind: "check" | "copy",
): WebElementNode => elementSpec(
  key,
  "svg",
  {
    "aria-hidden": true,
    "data-smoothstream-code-icon": kind,
    fill: "none",
    focusable: "false",
    height: 24,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    viewBox: "0 0 24 24",
    width: 24,
  },
  kind === "copy"
    ? [
        elementSpec(
          `${key}:rect`,
          "rect",
          { height: 14, rx: 2, ry: 2, width: 14, x: 8, y: 8 },
          [],
          "svg",
        ),
        elementSpec(
          `${key}:path`,
          "path",
          { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" },
          [],
          "svg",
        ),
      ]
    : [elementSpec(
        `${key}:path`,
        "path",
        { d: "M20 6 9 17l-5-5" },
        [],
        "svg",
      )],
  "svg",
);

const enhancedCodeBlock = (
  rendered: WebElementNode,
  label: string,
  copyReady: boolean,
): WebElementNode => {
  const key = `${rendered.key}:enhanced`;
  const copyLabel = label ? `Copy ${label} code` : "Copy code";
  return elementSpec(
    rendered.key,
    "pre",
    {
      ...rendered.properties,
      "data-smoothstream-code-block": true,
    },
    [
      elementSpec(
        `${key}:toolbar`,
        "span",
        { "data-smoothstream-code-toolbar": true },
        [
          elementSpec(
            `${key}:language`,
            "span",
            { "data-smoothstream-code-language": true },
            label ? [textSpec(`${key}:language:text`, label)] : [],
          ),
          elementSpec(
            `${key}:copy`,
            "button",
            {
              "aria-hidden": copyReady ? undefined : true,
              "aria-label": copyLabel,
              "data-smoothstream-code-copy": true,
              "data-smoothstream-ready": copyReady,
              disabled: !copyReady,
              tabIndex: copyReady ? 0 : -1,
              type: "button",
            },
            [elementSpec(
              `${key}:icons`,
              "span",
              {
                "aria-hidden": true,
                "data-smoothstream-code-icon-swap": true,
                "data-state": "copy",
              },
              [
                codeIcon(`${key}:copy-icon`, "copy"),
                codeIcon(`${key}:check-icon`, "check"),
              ],
            )],
          ),
        ],
      ),
      ...rendered.children,
    ],
  );
};

const tableShell = (
  table: WebElementNode,
  node: HastElement,
  path: string,
): WebElementNode => elementSpec(
  `${nodeKey(node, path)}:shell`,
  "div",
  { "data-smoothstream-table-shell": true },
  [elementSpec(
    `${nodeKey(node, path)}:scroll`,
    "div",
    { "data-smoothstream-table-scroll": true },
    [table],
  )],
);

const rawNode = (node: ElementContent, path: string): WebRenderNode[] => {
  if (node.type === "text") return [textSpec(`${nodeKey(node, path)}:raw`, node.value)];
  if (node.type !== "element") return [];
  const children = node.children.flatMap((child, index) =>
    rawNode(child, `${path}.${index}`)
  );
  const rendered = elementSpec(nodeKey(node, path), node.tagName, node.properties, children);
  return node.tagName === "table" ? [tableShell(rendered, node, path)] : [rendered];
};

const transformImage = (
  node: HastElement,
  schedule: ScheduledUnit,
  state: WebPresentationState,
  path: string,
  standalone: boolean,
): WebRenderNode[] => {
  const baseProperties: Record<string, unknown> = {
    ...node.properties,
    ...(standalone ? { "data-smoothstream-image-standalone": true } : {}),
  };
  if (state.immediate) {
    return [elementSpec(nodeKey(node, path), "img", baseProperties, [])];
  }

  const readiness = state.images.get(schedule.id);
  if (!readiness) {
    if (!isVisible(schedule, state.now)) return [];
    return [elementSpec(nodeKey(node, path), "img", {
      ...baseProperties,
      "aria-hidden": true,
      "data-smoothstream-image": "pending",
      "data-smoothstream-state": "pending",
      "data-smoothstream-unit": schedule.id,
      decoding: "async",
      style: styleWith(baseProperties.style, {
        ...(standalone ? { display: "block" } : {}),
        visibility: "hidden",
      }),
    }, [])];
  }
  const effectiveSchedule: ScheduledUnit = {
    ...schedule,
    endAt: Math.max(schedule.startAt, readiness.readyAt) + schedule.duration,
    startAt: Math.max(schedule.startAt, readiness.readyAt),
  };
  if (!isVisible(effectiveSchedule, state.now)) return [];
  if (
    state.compactedUnitIds.has(schedule.id) &&
    state.now >= effectiveSchedule.endAt
  ) {
    return [elementSpec(nodeKey(node, path), "img", baseProperties, [])];
  }
  const properties: Record<string, unknown> = {
    ...baseProperties,
    decoding: "async",
  };
  if (readiness.status === "ready") {
    if (readiness.width !== undefined) properties.width = readiness.width;
    if (readiness.height !== undefined) properties.height = readiness.height;
  }
  properties["data-smoothstream-image"] = readiness.status;
  return [elementSpec(
    nodeKey(node, path),
    "img",
    isAnimating(effectiveSchedule, state.now)
      ? activeWebProperties(properties, effectiveSchedule, "image", state.now)
      : retainedWebProperties(properties, effectiveSchedule),
    [],
  )];
};

const inlineContentIsSettled = (
  node: HastElement,
  state: WebPresentationState,
  fallbackSchedule: ScheduledUnit,
): boolean => {
  if (state.immediate) return true;

  let foundScheduledContent = false;
  let settled = true;
  const visit = (child: ElementContent): void => {
    if (child.type === "text") {
      const range = nodeRange(child);
      if (!range) return;
      const segments = cachedGraphemes(child.value, state.cache);
      const schedules = resolvedTextSchedules(child, range, segments, state);
      segments.forEach((segment, index) => {
        if (!/\S/u.test(segment.value)) return;
        const schedule = schedules[index];
        if (schedule) {
          foundScheduledContent = true;
          settled &&= state.now >= schedule.endAt;
        }
      });
      return;
    }
    if (child.type !== "element") return;
    if (child.tagName === "img") {
      const range = nodeRange(child);
      const schedule = range
        ? state.schedules.get(createRangeUnitId("image", range))
        : undefined;
      if (schedule) {
        foundScheduledContent = true;
        const readiness = state.images.get(schedule.id);
        const startAt = readiness
          ? Math.max(schedule.startAt, readiness.readyAt)
          : undefined;
        settled &&=
          startAt !== undefined &&
          state.now >= startAt + schedule.duration;
      }
      return;
    }
    child.children.forEach(visit);
  };
  node.children.forEach(visit);
  return foundScheduledContent ? settled : state.now >= fallbackSchedule.endAt;
};

const transformNode = (
  node: ElementContent,
  state: WebPresentationState,
  path: string,
  insidePre = false,
  codeBlockStart?: number,
  retainPendingText = false,
  standaloneImage = false,
  reserveBufferedWords = true,
): WebRenderNode[] => {
  if (node.type === "text") {
    return codeBlockStart === undefined
      ? transformText(
          node,
          state,
          path,
          retainPendingText,
          reserveBufferedWords,
        )
      : transformCodeText(node, codeBlockStart, state, path);
  }
  if (node.type !== "element") return [];
  if (node.tagName === "table" && !hasVisibleTableRow(node, state)) return [];

  const range = nodeRange(node);
  const kind = elementRevealKind(node, insidePre);
  const schedule = kind && range
    ? state.schedules.get(createRangeUnitId(kind, range))
    : undefined;
  if (kind && (!range || !schedule)) return [];
  if (kind === "image" && schedule) {
    return transformImage(node, schedule, state, path, standaloneImage);
  }
  if (kind && schedule && !isVisible(schedule, state.now)) {
    if (kind === "table-row") {
      const children = node.children.flatMap((child, index) =>
        rawNode(child, `${path}.${index}`)
      );
      return [elementSpec(nodeKey(node, path), node.tagName, {
        ...node.properties,
        "aria-hidden": true,
        "data-smoothstream-state": "pending",
        "data-smoothstream-unit": schedule.id,
        style: styleWith(node.properties.style, { visibility: "collapse" }),
      }, children)];
    }
    if (
      retainPendingText &&
      (kind === "inline" || kind === "link") &&
      INLINE_GROUP_TAGS.has(node.tagName)
    ) {
      return [elementSpec(nodeKey(node, path), node.tagName, {
        ...node.properties,
        ...pendingWebProperties(schedule),
      }, node.children.flatMap((child, index) => rawNode(child, `${path}.${index}`)))];
    }
    return [];
  }
  if (
    kind &&
    schedule &&
    state.compactedUnitIds.has(schedule.id) &&
    !(kind === "link" && !inlineContentIsSettled(node, state, schedule))
  ) {
    return rawNode(node, path);
  }

  const nextInsidePre = insidePre || node.tagName === "pre";
  const nextCodeBlockStart = node.tagName === "pre" ? range?.start : codeBlockStart;
  const meaningfulChildren = node.children.filter(
    (child) => child.type !== "text" || /\S/u.test(child.value),
  );
  const standaloneChild =
    node.tagName === "p" &&
    meaningfulChildren.length === 1 &&
    meaningfulChildren[0]?.type === "element" &&
    meaningfulChildren[0].tagName === "img"
      ? meaningfulChildren[0]
      : undefined;
  const firstSchedule = node.tagName === "li" ? firstScheduleInside(node, state) : undefined;
  const children: WebRenderNode[] = [];
  for (const [index, child] of node.children.entries()) {
    if (
      node.tagName === "li" &&
      child.type === "element" &&
      child.tagName === "input" &&
      child.properties.type === "checkbox"
    ) {
      if (firstSchedule && isVisible(firstSchedule, state.now)) {
        children.push(elementSpec(
          nodeKey(child, `${path}.${index}`),
          child.tagName,
          isAnimating(firstSchedule, state.now)
            ? {
                ...child.properties,
                "data-smoothstream-animation-duration": firstSchedule.duration,
                "data-smoothstream-animation-start": firstSchedule.startAt,
                "data-smoothstream-task": "active",
              }
            : child.properties,
          [],
        ));
      }
      continue;
    }
    children.push(...transformNode(
      child,
      state,
      `${path}.${index}`,
      nextInsidePre,
      nextCodeBlockStart,
      retainPendingText || kind === "table-row",
      child === standaloneChild,
      reserveBufferedWords && node.tagName !== "code",
    ));

    if (
      node.tagName === "p" &&
      child.type === "element" &&
      child.tagName === "img" &&
      child !== standaloneChild
    ) {
      const childRange = nodeRange(child);
      const childSchedule = childRange
        ? state.schedules.get(createRangeUnitId("image", childRange))
        : undefined;
      if (
        !state.immediate &&
        childSchedule &&
        !state.images.has(childSchedule.id)
      ) {
        break;
      }
    }
  }
  if (PRUNABLE_CONTAINERS.has(node.tagName) && !hasRenderedContent(children)) return [];

  let properties: WebProperties = node.properties;
  if (kind && schedule) {
    if ((kind === "inline" || kind === "link") && range) {
      const settled = inlineContentIsSettled(node, state, schedule);
      const inlineWebProperties: Record<string, unknown> = {
        ...properties,
        "data-smoothstream-state": settled ? "settled" : "active",
        "data-smoothstream-unit": schedule.id,
      };
      if (kind === "link" && !settled) {
        delete inlineWebProperties.href;
        delete inlineWebProperties.title;
        inlineWebProperties["aria-disabled"] = true;
        inlineWebProperties.tabIndex = -1;
      }
      properties = inlineWebProperties;
    } else if (kind === "table-row") {
      properties = {
        ...activeWebProperties(properties, schedule, kind, state.now),
        "data-smoothstream-state": isAnimating(schedule, state.now)
          ? undefined
          : "settled",
      };
    } else {
      properties = isAnimating(schedule, state.now)
        ? activeWebProperties(properties, schedule, kind, state.now)
        : retainedWebProperties(properties, schedule);
    }
  }
  if (node.tagName === "li" && firstSchedule && isAnimating(firstSchedule, state.now)) {
    properties = {
      ...properties,
      "data-smoothstream-animation-duration": firstSchedule.duration,
      "data-smoothstream-animation-start": firstSchedule.startAt,
      "data-smoothstream-marker": "active",
    };
  }
  properties = codeBlockWebProperties(node, state, properties);
  const rendered = elementSpec(nodeKey(node, path), node.tagName, properties, children);
  if (
    node.tagName === "pre" &&
    typeof properties["data-smoothstream-code-label"] === "string"
  ) {
    return [enhancedCodeBlock(
      rendered,
      properties["data-smoothstream-code-label"],
      properties["data-smoothstream-code-copy-ready"] === true,
    )];
  }
  return node.tagName === "table" ? [tableShell(rendered, node, path)] : [rendered];
};

export const createWebPresentation = (
  state: WebPresentationState,
): ReadonlyArray<WebRenderNode> =>
  state.tree.children.flatMap((node: RootContent, index) =>
    node.type === "element"
      ? transformNode(node, state, `${index}`)
      : node.type === "text"
        ? transformText(node, state, `${index}`, false, true)
        : []
  );
