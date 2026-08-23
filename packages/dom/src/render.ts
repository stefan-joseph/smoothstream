import type {
  Element as HastElement,
  ElementContent,
  Root,
  RootContent,
  Text,
} from "hast";
import { find, html, svg } from "property-information";
import {
  createCodeCharacterUnitId,
  createCodeLineUnitId,
  createRangeUnitId,
  segmentGraphemes,
  type ImageReadiness,
  type CodeHighlightLine,
  type MarkdownReveal,
  type MarkdownRevealKind,
  type MarkdownRevealUnit,
  type ResolvedCodeHighlight,
  type ScheduledUnit,
  type SourceRange,
} from "@smoothstream/core";

type Properties = Readonly<Record<string, unknown>>;

interface TextSpec {
  readonly key: string;
  readonly type: "text";
  readonly value: string;
}

interface ElementSpec {
  readonly children: ReadonlyArray<DomSpec>;
  readonly key: string;
  readonly namespace?: "svg";
  readonly properties: Properties;
  readonly tagName: string;
  readonly type: "element";
}

type DomSpec = ElementSpec | TextSpec;

export interface DomRenderState {
  readonly codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  readonly compactedBlockIds: ReadonlySet<string>;
  readonly compactedUnitIds: ReadonlySet<string>;
  readonly images: ReadonlyMap<string, ImageReadiness>;
  readonly now: number;
  readonly reveal: MarkdownReveal;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
  readonly tree: Root;
  readonly units: ReadonlyArray<MarkdownRevealUnit>;
}

const PRUNABLE_CONTAINERS = new Set([
  "a", "blockquote", "code", "del", "em", "h1", "h2", "h3", "h4",
  "h5", "h6", "li", "ol", "p", "pre", "strong", "table", "tbody",
  "thead", "ul",
]);
const INLINE_GROUP_TAGS = new Set(["a", "code", "del", "em", "strong"]);

const textSpec = (key: string, value: string): TextSpec => ({
  key,
  type: "text",
  value,
});

const elementSpec = (
  key: string,
  tagName: string,
  properties: Properties,
  children: ReadonlyArray<DomSpec>,
  namespace?: "svg",
): ElementSpec => ({
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

const activeProperties = (
  properties: Properties,
  schedule: ScheduledUnit,
  kind: MarkdownRevealKind,
  now: number,
): Properties => ({
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

const retainedProperties = (
  properties: Properties,
  schedule: ScheduledUnit,
): Properties => ({
  ...properties,
  "data-smoothstream-state": "settled",
  "data-smoothstream-unit": schedule.id,
});

const pendingProperties = (schedule: ScheduledUnit): Properties => ({
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
  state: DomRenderState,
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
  state: DomRenderState,
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
  state: DomRenderState,
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

const hasRenderedContent = (children: ReadonlyArray<DomSpec>): boolean =>
  children.some((child) => child.type === "element" || /\S/u.test(child.value));

const transformText = (
  node: Text,
  state: DomRenderState,
  path: string,
  retainPending: boolean,
  reserveBufferedWords: boolean,
): DomSpec[] => {
  const range = nodeRange(node);
  if (!range) return [textSpec(`${path}:raw`, node.value)];

  const segments = segmentGraphemes(node.value);
  const schedules = segments.map((segment) =>
    /\S/u.test(segment.value)
      ? state.schedules.get(createRangeUnitId("text", {
          end: range.start + segment.end,
          start: range.start + segment.start,
        }))
      : undefined
  );
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
  const result: DomSpec[] = [];

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
            pendingProperties(schedule),
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
            ? activeProperties({}, schedule, "text", state.now)
            : retainedProperties({}, schedule)),
          "data-smoothstream-word": true,
        },
        [textSpec(`unit:${schedule.id}:text`, run.value)],
      ));
      return;
    }

    if (!scheduled.some((schedule) => isVisible(schedule, state.now)) && !retainPending) {
      return;
    }
    const children: DomSpec[] = [];
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
            pendingProperties(schedule),
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
          ? activeProperties({}, schedule, "text", state.now)
          : retainedProperties({}, schedule),
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
  state: DomRenderState,
  path: string,
): DomSpec[] => {
  const lines = node.value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const highlight = state.codeHighlights.get(blockStart);
  const lineSchedules = lines.map((_, lineIndex) =>
    state.schedules.get(createCodeLineUnitId(blockStart, lineIndex))
  );
  if (
    !highlight &&
    lineSchedules.length > 0 &&
    lineSchedules.every(
      (schedule) => schedule && state.compactedUnitIds.has(schedule.id),
    )
  ) {
    return [textSpec(`${path}:code:compacted`, node.value)];
  }
  const result: DomSpec[] = [];
  lines.forEach((line, lineIndex) => {
    const lineSchedule = state.schedules.get(createCodeLineUnitId(blockStart, lineIndex));
    if (!lineSchedule || !isVisible(lineSchedule, state.now)) return;
    const lineCompacted = state.compactedUnitIds.has(lineSchedule.id);
    const characters = segmentGraphemes(line);
    const renderCharacter = (
      character: (typeof characters)[number],
      characterIndex: number,
    ): DomSpec | undefined => {
      const schedule = state.schedules.get(
        createCodeCharacterUnitId(blockStart, lineIndex, characterIndex),
      );
      if (!schedule || !isVisible(schedule, state.now)) return undefined;
      if (state.compactedUnitIds.has(schedule.id)) {
        return textSpec(`unit:${schedule.id}:compacted`, character.value);
      }
      return elementSpec(
        `unit:${schedule.id}`,
        "span",
        isAnimating(schedule, state.now)
          ? activeProperties({}, schedule, "text", state.now)
          : retainedProperties({}, schedule),
        [textSpec(`unit:${schedule.id}:text`, character.value)],
      );
    };
    const highlightedChildren = (
      highlightedLine: CodeHighlightLine,
    ): DomSpec[] => {
      const children: DomSpec[] = [];
      let characterIndex = 0;
      let tokenStart = 0;
      highlightedLine.tokens.forEach((token, tokenIndex) => {
        const tokenEnd = tokenStart + token.content.length;
        const tokenChildren: DomSpec[] = [];
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

const codeBlockProperties = (
  node: HastElement,
  state: DomRenderState,
  properties: Properties,
): Properties => {
  if (node.tagName !== "pre") return properties;
  const blockStart = node.position?.start.offset;
  const highlight = blockStart === undefined
    ? undefined
    : state.codeHighlights.get(blockStart);
  const palette = highlight?.palette;
  const languageLabel = highlight?.languageLabel;
  const paletteStyle = {
    ...palette?.style,
    ...(palette?.backgroundColor
      ? { "--smoothstream-shiki-background": palette.backgroundColor }
      : {}),
    ...(palette?.color
      ? { "--smoothstream-shiki-color": palette.color }
      : {}),
  };

  if (!languageLabel && Object.keys(paletteStyle).length === 0) {
    return properties;
  }
  return {
    ...properties,
    ...(languageLabel
      ? {
          "data-smoothstream-code-copy-ready": blockStart !== undefined &&
            state.compactedBlockIds.has(`block:${blockStart}`),
          "data-smoothstream-code-label": languageLabel,
        }
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
): ElementSpec => elementSpec(
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
  rendered: ElementSpec,
  label: string,
  copyReady: boolean,
): ElementSpec => {
  const key = `${rendered.key}:enhanced`;
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
            [textSpec(`${key}:language:text`, label)],
          ),
          elementSpec(
            `${key}:copy`,
            "button",
            {
              "aria-hidden": copyReady ? undefined : true,
              "aria-label": `Copy ${label} code`,
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
  table: ElementSpec,
  node: HastElement,
  path: string,
): ElementSpec => elementSpec(
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

const rawNode = (node: ElementContent, path: string): DomSpec[] => {
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
  state: DomRenderState,
  path: string,
  standalone: boolean,
): DomSpec[] => {
  const properties: Record<string, unknown> = {
    ...node.properties,
    ...(standalone ? { "data-smoothstream-image-standalone": true } : {}),
    decoding: "async",
  };
  const readiness = state.images.get(schedule.id);
  if (!readiness) {
    if (!isVisible(schedule, state.now)) return [];
    return [elementSpec(nodeKey(node, path), "img", {
      ...properties,
      "aria-hidden": true,
      "data-smoothstream-image": "pending",
      "data-smoothstream-state": "pending",
      "data-smoothstream-unit": schedule.id,
      style: styleWith(properties.style, {
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
  if (readiness.status === "ready") {
    if (readiness.width !== undefined) properties.width = readiness.width;
    if (readiness.height !== undefined) properties.height = readiness.height;
  }
  properties["data-smoothstream-image"] = readiness.status;
  const settled =
    state.compactedUnitIds.has(schedule.id) && state.now >= effectiveSchedule.endAt;
  return [elementSpec(
    nodeKey(node, path),
    "img",
    settled
      ? properties
      : isAnimating(effectiveSchedule, state.now)
        ? activeProperties(properties, effectiveSchedule, "image", state.now)
        : retainedProperties(properties, effectiveSchedule),
    [],
  )];
};

const transformNode = (
  node: ElementContent,
  state: DomRenderState,
  path: string,
  insidePre = false,
  codeBlockStart?: number,
  retainPendingText = false,
  standaloneImage = false,
): DomSpec[] => {
  if (node.type === "text") {
    return codeBlockStart === undefined
      ? transformText(node, state, path, retainPendingText, true)
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
        ...pendingProperties(schedule),
      }, node.children.flatMap((child, index) => rawNode(child, `${path}.${index}`)))];
    }
    return [];
  }
  if (kind && schedule && state.compactedUnitIds.has(schedule.id)) {
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
  const children = node.children.flatMap((child, index) => {
    if (
      node.tagName === "li" &&
      child.type === "element" &&
      child.tagName === "input" &&
      child.properties.type === "checkbox"
    ) {
      if (!firstSchedule || !isVisible(firstSchedule, state.now)) return [];
      return [elementSpec(nodeKey(child, `${path}.${index}`), child.tagName,
        isAnimating(firstSchedule, state.now)
          ? {
              ...child.properties,
              "data-smoothstream-animation-duration": firstSchedule.duration,
              "data-smoothstream-animation-start": firstSchedule.startAt,
              "data-smoothstream-task": "active",
            }
          : child.properties,
        [],
      )];
    }
    return transformNode(
      child,
      state,
      `${path}.${index}`,
      nextInsidePre,
      nextCodeBlockStart,
      retainPendingText || kind === "table-row",
      child === standaloneChild,
    );
  });
  if (PRUNABLE_CONTAINERS.has(node.tagName) && !hasRenderedContent(children)) return [];

  let properties: Properties = node.properties;
  if (kind && schedule) {
    if ((kind === "inline" || kind === "link") && range) {
      const settled = schedulesInside(range, state).every(
        (candidate) => state.now >= candidate.endAt,
      );
      const inlineProperties: Record<string, unknown> = {
        ...properties,
        "data-smoothstream-state": settled ? "settled" : "active",
        "data-smoothstream-unit": schedule.id,
      };
      if (kind === "link" && !settled) {
        delete inlineProperties.href;
        delete inlineProperties.title;
        inlineProperties["aria-disabled"] = true;
        inlineProperties.tabIndex = -1;
      }
      properties = inlineProperties;
    } else {
      properties = isAnimating(schedule, state.now)
        ? activeProperties(properties, schedule, kind, state.now)
        : retainedProperties(properties, schedule);
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
  properties = codeBlockProperties(node, state, properties);
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

const domNodeKeys = new WeakMap<Node, string>();
const appliedAttributes = new WeakMap<Element, ReadonlyMap<string, string>>();
const appliedStyles = new WeakMap<HTMLElement, ReadonlyMap<string, string>>();
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const cssPropertyName = (property: string): string =>
  property.startsWith("--")
    ? property
    : property.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);

const normalizedAttributes = (
  element: Element,
  properties: Properties,
): Map<string, string> => {
  const result = new Map<string, string>();
  const schema = element.namespaceURI === SVG_NAMESPACE ? svg : html;
  for (const [property, originalValue] of Object.entries(properties)) {
    if (
      property === "children" || property === "style" ||
      originalValue === null || originalValue === undefined || originalValue === false ||
      (typeof originalValue === "number" && Number.isNaN(originalValue))
    ) continue;
    const information = find(schema, property);
    const value = Array.isArray(originalValue)
      ? originalValue.map(String).join(information.commaSeparated ? ", " : " ").trim()
      : information.boolean && originalValue === true
        ? ""
        : String(originalValue);
    result.set(information.attribute, value);
  }
  return result;
};

const normalizedStyles = (style: unknown): Map<string, string> => {
  const result = new Map<string, string>();
  if (typeof style === "string") {
    result.set("cssText", style);
    return result;
  }
  if (typeof style !== "object" || style === null) return result;
  for (const [property, value] of Object.entries(style)) {
    if (value !== null && value !== undefined) {
      result.set(cssPropertyName(property), String(value));
    }
  }
  return result;
};

const applyProperties = (element: Element, properties: Properties): void => {
  const nextAttributes = normalizedAttributes(element, properties);
  const previousAttributes = appliedAttributes.get(element) ?? new Map();
  for (const name of previousAttributes.keys()) {
    if (!nextAttributes.has(name)) element.removeAttribute(name);
  }
  for (const [name, value] of nextAttributes) {
    if (previousAttributes.get(name) !== value) element.setAttribute(name, value);
  }
  appliedAttributes.set(element, nextAttributes);

  const view = element.ownerDocument.defaultView;
  if (!view || !(element instanceof view.HTMLElement)) return;
  const nextStyles = normalizedStyles(properties.style);
  const previousStyles = appliedStyles.get(element) ?? new Map();
  const previousAnimationDelay = previousStyles.get(
    "--smoothstream-animation-delay",
  );
  if (
    previousAnimationDelay !== undefined &&
    nextStyles.has("--smoothstream-animation-delay")
  ) {
    // Phase compensation belongs to the moment a unit enters the DOM. Keeping
    // that first value avoids retiming an animation when later units reconcile.
    nextStyles.set("--smoothstream-animation-delay", previousAnimationDelay);
  }
  if (nextStyles.has("cssText")) {
    const cssText = nextStyles.get("cssText") ?? "";
    if (previousStyles.get("cssText") !== cssText) element.style.cssText = cssText;
  } else {
    for (const name of previousStyles.keys()) {
      if (name !== "cssText" && !nextStyles.has(name)) element.style.removeProperty(name);
    }
    for (const [name, value] of nextStyles) {
      if (previousStyles.get(name) !== value) element.style.setProperty(name, value);
    }
  }
  appliedStyles.set(element, nextStyles);
};

const compatible = (node: Node, spec: DomSpec): boolean =>
  spec.type === "text"
    ? node.nodeType === node.TEXT_NODE
    : node.nodeType === node.ELEMENT_NODE && (node as Element).localName === spec.tagName;

const createNode = (parent: Element, spec: DomSpec): Node => {
  const document = parent.ownerDocument;
  const node = spec.type === "text"
    ? document.createTextNode(spec.value)
    : spec.namespace === "svg" || parent.namespaceURI === SVG_NAMESPACE
      ? document.createElementNS(SVG_NAMESPACE, spec.tagName)
      : document.createElement(spec.tagName);
  domNodeKeys.set(node, spec.key);
  return node;
};

const reconcileNode = (node: Node, spec: DomSpec): void => {
  domNodeKeys.set(node, spec.key);
  if (spec.type === "text") {
    if (node.nodeValue !== spec.value) node.nodeValue = spec.value;
    return;
  }
  applyProperties(node as Element, spec.properties);
  reconcileChildren(node as Element, spec.children);
};

const reconcileChildren = (parent: Element, specs: ReadonlyArray<DomSpec>): void => {
  if (specs.length === 1 && specs[0]?.type === "text") {
    const spec = specs[0];
    const current = parent.firstChild;
    const node =
      parent.childNodes.length === 1 &&
        current !== null &&
        compatible(current, spec)
        ? current
        : createNode(parent, spec);
    reconcileNode(node, spec);
    if (parent.childNodes.length !== 1 || parent.firstChild !== node) {
      // Settlement collapses many animated unit spans into one plain text node.
      // Replace them atomically so the browser never paints the container while
      // its former children are being removed one by one.
      parent.replaceChildren(node);
    }
    return;
  }

  const nextKeys = new Set(specs.map((spec) => spec.key));
  for (const child of [...parent.childNodes]) {
    const key = domNodeKeys.get(child);
    if (key !== undefined && !nextKeys.has(key)) child.remove();
  }

  const byKey = new Map([...parent.childNodes].flatMap((node) => {
    const key = domNodeKeys.get(node);
    return key ? [[key, node] as const] : [];
  }));
  specs.forEach((spec, index) => {
    const keyed = byKey.get(spec.key);
    const node = keyed && compatible(keyed, spec)
      ? keyed
      : createNode(parent, spec);
    reconcileNode(node, spec);
    const current = parent.childNodes[index];
    if (current !== node) parent.insertBefore(node, current ?? null);
  });
  while (parent.childNodes.length > specs.length) parent.lastChild?.remove();
};

export const renderDom = (root: HTMLElement, state: DomRenderState): void => {
  const children = state.tree.children.flatMap((node: RootContent, index) =>
    node.type === "element"
      ? transformNode(node, state, `${index}`)
      : node.type === "text"
        ? transformText(node, state, `${index}`, false, true)
        : []
  );
  reconcileChildren(root, children);
};
