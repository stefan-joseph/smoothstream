import type { Root, RootContent } from "hast";
import {
  createElement,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { find, hastToReact, html, svg } from "property-information";
import type {
  ImageReadiness,
  MarkdownReveal,
  MarkdownRevealUnit,
  ResolvedCodeHighlight,
  ScheduledUnit,
  SourceRange,
} from "@smoothstream/core";
import {
  createWebPresentation,
  createWebPresentationCache,
  type WebCompactedUnitLookup,
  type WebElementNode,
  type WebPresentationCache,
  type WebRenderNode,
} from "@smoothstream/core/web";

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

export interface HastRenderCache {
  readonly blockTimingsByRoot: WeakMap<
    Root,
    WeakMap<
      ReadonlyMap<string, ScheduledUnit>,
      ReadonlyMap<string, HastBlockTiming>
    >
  >;
  readonly blocksByRoot: WeakMap<Root, ReadonlyArray<HastRenderBlock>>;
  readonly presentation: WebPresentationCache;
}

export const createHastRenderCache = (): HastRenderCache => ({
  blockTimingsByRoot: new WeakMap(),
  blocksByRoot: new WeakMap(),
  presentation: createWebPresentationCache(),
});

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

interface CopyContext {
  readonly copied: boolean;
  readonly copy: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

interface ReactPropertyInfo {
  readonly commaSeparated: boolean;
  readonly name: string;
}

const htmlPropertyInfoByName = new Map<string, ReactPropertyInfo>();
const svgPropertyInfoByName = new Map<string, ReactPropertyInfo>();
const tableContainers = new Set(["table", "tbody", "tfoot", "thead", "tr"]);
const tableCells = new Set(["td", "th"]);

const reactPropertyInfo = (
  property: string,
  namespace: "svg" | undefined,
): ReactPropertyInfo => {
  const cache = namespace === "svg"
    ? svgPropertyInfoByName
    : htmlPropertyInfoByName;
  const cached = cache.get(property);
  if (cached) return cached;

  const information = find(namespace === "svg" ? svg : html, property);
  const result = {
    commaSeparated: information.commaSeparated,
    name: information.space
      ? hastToReact[information.property] ?? information.property
      : information.attribute,
  };
  cache.set(property, result);
  return result;
};

const reactElementProperties = (
  node: WebElementNode,
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

    const information = reactPropertyInfo(property, node.namespace);
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

const textContent = (node: WebRenderNode): string =>
  node.type === "text"
    ? node.value
    : node.children.map(textContent).join("");

const codeBlockValue = (node: WebElementNode): string => {
  const code = node.children.find(
    (child): child is WebElementNode =>
      child.type === "element" && child.tagName === "code",
  );
  const value = code ? textContent(code) : "";
  return value.endsWith("\n") ? value.slice(0, -1) : value;
};

const webChildrenToReact = (
  children: ReadonlyArray<WebRenderNode>,
  filterTableWhitespace: boolean,
  copyContext?: CopyContext,
): ReactNode[] => children.flatMap((child) => {
  if (
    filterTableWhitespace &&
    child.type === "text" &&
    /^\s*$/u.test(child.value)
  ) {
    return [];
  }
  return [webNodeToReact(child, copyContext)];
});

const webElementToReact = (
  node: WebElementNode,
  copyContext?: CopyContext,
): ReactNode => {
  const properties = reactElementProperties(node);
  if (copyContext) {
    if (node.properties["data-smoothstream-code-copy"] === true) {
      properties.onClick = copyContext.copy;
      if (copyContext.copied) properties["aria-label"] = "Code copied";
    }
    if (node.properties["data-smoothstream-code-icon-swap"] === true) {
      properties["data-state"] = copyContext.copied ? "check" : "copy";
    }
  }
  const children = webChildrenToReact(
    node.children,
    tableContainers.has(node.tagName),
    copyContext,
  );
  return createElement(node.tagName, {
    ...properties,
    key: node.key,
  }, ...children);
};

interface WebCodeBlockProps {
  readonly node: WebElementNode;
}

const WebCodeBlock = ({ node }: WebCodeBlockProps): ReactNode => {
  const code = codeBlockValue(node);
  const copyReady = node.properties["data-smoothstream-code-copy-ready"] ===
    true;
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

  const copy = (): void => {
    if (!copyReady) return;
    void writeClipboardText(code).then(
      () => {
        setCopied(true);
        if (resetTimerRef.current !== undefined) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          resetTimerRef.current = undefined;
        }, 2_000);
      },
      () => setCopied(false),
    );
  };

  return webElementToReact(node, { copied, copy });
};

const webNodeToReact = (
  node: WebRenderNode,
  copyContext?: CopyContext,
): ReactNode => {
  if (node.type === "text") return node.value;
  if (
    !copyContext &&
    node.tagName === "pre" &&
    node.properties["data-smoothstream-code-block"] === true
  ) {
    return createElement(WebCodeBlock, { key: node.key, node });
  }
  return webElementToReact(node, copyContext);
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
  if (cached) return cached;

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
  if (cached) return cached;

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

const blockRenderRevision = (
  block: HastRenderBlock,
  timing: HastBlockTiming,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  now: number,
  compactedUnitIds: WebCompactedUnitLookup,
  compactedBlockIds: ReadonlySet<string> | undefined,
  images: ReadonlyMap<string, ImageReadiness>,
  visibleUnitCount: number,
  codeHighlightRevision: number,
): string => {
  const imageStates: string[] = [];
  for (const unit of block.imageUnits) {
    const schedule = schedules.get(unit.id);
    if (!schedule) continue;
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
    imageStates.push([
      unit.id,
      readiness.status,
      readiness.readyAt,
      readiness.width ?? "auto",
      readiness.height ?? "auto",
      phase,
    ].join(":"));
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

const EMPTY_BLOCK_IDS: ReadonlySet<string> = new Set();

interface HastBlockProps {
  readonly block: HastRenderBlock;
  readonly cache: HastRenderCache;
  readonly codeHighlighterEnabled: boolean;
  readonly codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight>;
  readonly compactedBlockIds: ReadonlySet<string> | undefined;
  readonly compactedUnitIds: WebCompactedUnitLookup;
  readonly images: ReadonlyMap<string, ImageReadiness>;
  readonly immediate: boolean;
  readonly now: number;
  readonly reveal: MarkdownReveal;
  readonly revision: string;
  readonly schedules: ReadonlyMap<string, ScheduledUnit>;
  readonly showLanguageLabels: boolean;
}

const HastBlock = ({
  block,
  cache,
  codeHighlighterEnabled,
  codeHighlights,
  compactedBlockIds,
  compactedUnitIds,
  images,
  immediate,
  now,
  reveal,
  schedules,
  showLanguageLabels,
}: HastBlockProps): ReactNode => {
  const nodes = createWebPresentation({
    cache: cache.presentation,
    codeHighlighterEnabled,
    codeHighlights,
    compactedBlockIds: compactedBlockIds ?? EMPTY_BLOCK_IDS,
    compactedUnitIds,
    images,
    immediate,
    now,
    reveal,
    schedules,
    showLanguageLabels,
    tree: { type: "root", children: [block.node] },
    units: block.units,
  });
  return nodes.map((node) => webNodeToReact(node));
};

const MemoizedHastBlock = memo(
  HastBlock,
  (previous, next) => previous.revision === next.revision,
);

export const renderHast = (
  tree: Root,
  schedules: ReadonlyMap<string, ScheduledUnit>,
  now: number,
  compactedUnitIds: WebCompactedUnitLookup,
  images: ReadonlyMap<string, ImageReadiness>,
  cache = createHastRenderCache(),
  visibleUnitCount = 0,
  units: ReadonlyArray<MarkdownRevealUnit> = [],
  compactedBlockIds?: ReadonlySet<string>,
  codeHighlights: ReadonlyMap<number, ResolvedCodeHighlight> = new Map(),
  codeHighlightRevision = 0,
  reveal: MarkdownReveal = "character",
  immediate = false,
  codeHighlighterEnabled = false,
  showLanguageLabels = true,
): ReactNode => {
  const blocks = prepareRenderBlocks(tree, units, cache);
  const timings = prepareBlockTimings(tree, blocks, schedules, cache);
  return blocks.map((block) =>
    createElement(MemoizedHastBlock, {
      block,
      cache,
      codeHighlighterEnabled,
      codeHighlights,
      compactedBlockIds,
      compactedUnitIds,
      images,
      immediate,
      key: block.key,
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
      ) + `|${reveal}|${immediate}|${codeHighlighterEnabled}|${showLanguageLabels}`,
      schedules,
      showLanguageLabels,
    })
  );
};
