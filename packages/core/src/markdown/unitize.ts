import type { Element, Node, Parent, Root, Text } from "hast";
import {
  createCodeCharacterUnitId,
  createCodeLineUnitId,
  createRangeUnitId,
} from "./identity";
import { segmentGraphemes } from "./graphemes";
import type {
  MarkdownPlan,
  MarkdownReveal,
  MarkdownRevealKind,
  MarkdownRevealUnit,
  SourceRange,
} from "./types";

const INLINE_GROUP_TAGS = new Set(["a", "code", "del", "em", "strong"]);

/**
 * Flowing prose is allowed to begin before its paragraph closes, but Smoothstream
 * keeps a small source lead so a short first line can still become a table or
 * a setext heading before any of it reaches the screen.
 */
const FLOW_LOOKAHEAD = 48;

const HEADING_INTERVALS_AFTER = 6;
const HORIZONTAL_RULE_DURATION_MULTIPLIER = 3;
const HORIZONTAL_RULE_INTERVALS_AFTER = 12;
const LIST_ITEM_INTERVALS_BEFORE = 4;

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;
const isText = (node: Node): node is Text => node.type === "text";

const nodeRange = (node: Node): SourceRange | undefined => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { end, start };
};

const isEscapedAt = (source: string, offset: number): boolean => {
  let backslashCount = 0;
  for (
    let index = offset - 1;
    index >= 0 && source[index] === "\\";
    index -= 1
  ) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

const isTaskListMarkerAt = (
  source: string,
  offset: number,
  label: string,
): boolean => {
  if (!/^[ xX]$/u.test(label)) {
    return false;
  }
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^(?: {0,3}>[\t ]?)*[\t ]*(?:[-+*]|\d+[.)])[\t ]+$/u.test(
    prefix,
  );
};

const stableInlineRanges = (node: Node): SourceRange[] => {
  const ranges: SourceRange[] = [];
  const visit = (candidate: Node): void => {
    if (
      isElement(candidate) &&
      ["a", "code", "img"].includes(candidate.tagName)
    ) {
      const range = nodeRange(candidate);
      if (range) {
        ranges.push(range);
      }
      return;
    }
    if (isParent(candidate)) {
      candidate.children.forEach(visit);
    }
  };
  visit(node);
  return ranges;
};

const normalizeReferenceIdentifier = (value: string): string =>
  value.trim().replaceAll(/\s+/gu, " ").toLowerCase();

const hasStableReferenceDefinition = (
  source: string,
  identifier: string,
): boolean => {
  const pattern = /^ {0,3}\[([^\]\r\n]+)\]:[^\r\n]*(?:\r?\n|$)/gmu;
  const normalizedIdentifier = normalizeReferenceIdentifier(identifier);

  for (const match of source.matchAll(pattern)) {
    if (normalizeReferenceIdentifier(match[1] ?? "") !== normalizedIdentifier) {
      continue;
    }
    const start = match.index;
    if (start === undefined || !match[0].endsWith("\n")) {
      return false;
    }
    // A blank line closes the definition block, including an optional title
    // on a following line, so later packets cannot extend either value.
    return /(?:^|\r?\n)[\t ]*\r?\n/u.test(
      source.slice(start + match[0].length),
    );
  }
  return false;
};

/**
 * A full or collapsed reference can become a link when a later definition
 * arrives. Keep that candidate provisional until it resolves or input closes.
 */
const hasUnresolvedReferenceSyntax = (
  node: Element,
  source: string,
): boolean => {
  const range = nodeRange(node);
  if (!range) {
    return false;
  }

  const stableRanges = stableInlineRanges(node);
  const blockSource = source.slice(range.start, range.end);
  const isUnresolved = (
    start: number,
    end: number,
    identifier: string,
  ): boolean => {
    const hasStableInline = stableRanges.some(
      (stable) => stable.start <= start && stable.end >= end,
    );
    return (
      !hasStableInline ||
      !hasStableReferenceDefinition(source, identifier)
    );
  };
  const fullPattern = /\[([^\]\r\n]+)\]\[([^\]\r\n]*)\]/gu;

  for (const match of blockSource.matchAll(fullPattern)) {
    const relativeStart = match.index;
    if (relativeStart === undefined) {
      continue;
    }
    const start = range.start + relativeStart;
    const end = start + match[0].length;
    if (isEscapedAt(source, start)) {
      continue;
    }
    const identifier = (match[2] ?? "").length > 0
      ? match[2] ?? ""
      : match[1] ?? "";
    if (isUnresolved(start, end, identifier)) {
      return true;
    }
  }

  const shortcutPattern = /\[([^\]\r\n]+)\](?![\[(])/gu;
  for (const match of blockSource.matchAll(shortcutPattern)) {
    const relativeStart = match.index;
    if (relativeStart === undefined) {
      continue;
    }
    const start = range.start + relativeStart;
    const end = start + match[0].length;
    if (
      !isEscapedAt(source, start) &&
      !isTaskListMarkerAt(source, start, match[1] ?? "") &&
      isUnresolved(start, end, match[1] ?? "")
    ) {
      return true;
    }
  }
  return false;
};

const textContent = (node: Node): string => {
  if (isText(node)) {
    return node.value;
  }
  if (!isParent(node)) {
    return "";
  }
  return node.children.map(textContent).join("");
};

const hasBlankLine = (value: string): boolean =>
  /(?:\r?\n)[\t ]*(?:\r?\n)/u.test(value);

const hasLineEnding = (value: string): boolean => /^\r?\n/u.test(value);

const canOpenUnsettledInlineMarkup = (
  source: string,
  offset: number,
): boolean => {
  const character = source[offset];
  if (character === undefined) {
    return false;
  }

  if (character === "\\") {
    return offset + 1 >= source.length;
  }
  if (character === "!") {
    return source[offset + 1] === "[" || offset + 1 >= source.length;
  }
  if (["<", "[", "`"].includes(character)) {
    return true;
  }
  if (!["*", "_", "~"].includes(character)) {
    return false;
  }

  let runEnd = offset + 1;
  while (source[runEnd] === character) {
    runEnd += 1;
  }
  const nextCharacter = source[runEnd];
  return nextCharacter === undefined || !/^\s$/u.test(nextCharacter);
};

const hasClosingFence = (value: string): boolean => {
  const lines = value.split(/\r?\n/u);
  const opening = lines[0]?.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  if (!opening) {
    return false;
  }

  const marker = opening[0];
  const minimumLength = opening.length;
  return lines.slice(1).some((line) => {
    const candidate = line.match(/^ {0,3}(`+|~+)[\t ]*$/u)?.[1];
    return (
      candidate !== undefined &&
      candidate[0] === marker &&
      candidate.length >= minimumLength
    );
  });
};

const blockquotePrefixLength = (line: string): number =>
  line.match(/^(?: {0,3}>[\t ]?)+/u)?.[0].length ?? 0;

const normalizeFencedBlockSource = (
  value: string,
  insideBlockquote: boolean,
): string => insideBlockquote
  ? value
      .split(/\r?\n/u)
      .map((line, lineIndex) =>
        lineIndex === 0 ? line : line.slice(blockquotePrefixLength(line)),
      )
      .join("\n")
  : value;

const isConfirmedRootBlock = (
  block: Element,
  blockIndex: number,
  blocks: ReadonlyArray<Element>,
  source: string,
  inputOpen: boolean,
): boolean => {
  if (!inputOpen || blockIndex < blocks.length - 1) {
    return true;
  }

  const range = nodeRange(block);
  if (!range) {
    return false;
  }

  const tail = source.slice(range.end);
  if (hasBlankLine(tail)) {
    return true;
  }

  if (/^h[1-6]$/u.test(block.tagName) || block.tagName === "hr") {
    return hasLineEnding(tail);
  }

  if (block.tagName === "pre") {
    return hasClosingFence(source.slice(range.start, range.end));
  }

  return false;
};

interface PlannerContext {
  confirmedBlockIds: Set<string>;
  nextOrder: number;
  referenceBlocked: boolean;
  reveal: MarkdownReveal;
  source: string;
  units: MarkdownRevealUnit[];
}

const addRangeUnit = (
  context: PlannerContext,
  kind: "block" | "image" | "table-row" | "text",
  blockId: string,
  range: SourceRange,
  value: string,
): void => {
  const unit: MarkdownRevealUnit = {
    blockId,
    id: createRangeUnitId(kind, range),
    kind,
    order: context.nextOrder,
    sourceRange: range,
    value,
  };
  if (kind === "text") {
    context.units.push(unit);
  } else if (kind === "table-row") {
    context.units.push({
      ...unit,
      // The row begins fading immediately; its first character follows two
      // configured interval ticks later.
      intervalsAfter: 2,
    });
  } else if (kind === "image") {
    context.units.push({
      ...unit,
      // Images enter atomically, while following content may continue shortly
      // afterward even if the external resource is still loading.
      intervalsAfter: 12,
    });
  } else {
    context.units.push({
      ...unit,
      allowFollowingFinishOverlap: true,
      durationMultiplier: HORIZONTAL_RULE_DURATION_MULTIPLIER,
      intervalsAfter: HORIZONTAL_RULE_INTERVALS_AFTER,
    });
  }
  context.nextOrder += 1;
};

const setLastUnitIntervalsAfter = (
  context: PlannerContext,
  firstUnitIndex: number,
  intervalsAfter: number,
): void => {
  const lastUnitIndex = context.units.length - 1;
  const lastUnit = context.units[lastUnitIndex];
  if (lastUnit && lastUnitIndex >= firstUnitIndex) {
    context.units[lastUnitIndex] = { ...lastUnit, intervalsAfter };
  }
};

const setFirstUnitIntervalsBefore = (
  context: PlannerContext,
  firstUnitIndex: number,
  intervalsBefore: number,
): void => {
  const firstUnit = context.units[firstUnitIndex];
  if (firstUnit) {
    context.units[firstUnitIndex] = { ...firstUnit, intervalsBefore };
  }
};

interface FlowContext {
  blockId: string;
  planner: PlannerContext;
  protectUnsettledMarkup: boolean;
  safeEnd: number;
  stopped: boolean;
}

const collectFlowText = (node: Text, context: FlowContext): void => {
  const range = nodeRange(node);
  if (!range || context.stopped) {
    return;
  }

  const graphemes = segmentGraphemes(node.value);
  let index = 0;
  while (index < graphemes.length) {
    const first = graphemes[index];
    if (!first) {
      break;
    }
    if (/^\s+$/u.test(first.value)) {
      index += 1;
      continue;
    }

    let wordEndIndex = index + 1;
    while (
      wordEndIndex < graphemes.length &&
      !/^\s+$/u.test(graphemes[wordEndIndex]?.value ?? "")
    ) {
      wordEndIndex += 1;
    }

    const last = graphemes[wordEndIndex - 1];
    const wordEnd = last === undefined ? range.start : range.start + last.end;
    if (wordEnd > context.safeEnd) {
      context.stopped = true;
      return;
    }

    if (context.protectUnsettledMarkup) {
      for (
        let segmentIndex = index;
        segmentIndex < wordEndIndex;
        segmentIndex += 1
      ) {
        const segment = graphemes[segmentIndex];
        const start = range.start + (segment?.start ?? 0);
        if (
          segment &&
          canOpenUnsettledInlineMarkup(context.planner.source, start)
        ) {
          context.stopped = true;
          return;
        }
      }
    }

    for (
      let segmentIndex = index;
      segmentIndex < wordEndIndex;
      segmentIndex += 1
    ) {
      const segment = graphemes[segmentIndex];
      if (!segment) {
        continue;
      }
      const start = range.start + segment.start;
      const unitRange = { end: range.start + segment.end, start };
      addRangeUnit(
        context.planner,
        "text",
        context.blockId,
        unitRange,
        segment.value,
      );
      if (context.planner.reveal === "word") {
        setLastUnitIntervalsAfter(
          context.planner,
          context.planner.units.length - 1,
          segmentIndex < wordEndIndex - 1 ? 0 : wordEndIndex - index,
        );
      }
    }
    index = wordEndIndex;
  }
};

const collectFlow = (node: Node, context: FlowContext): void => {
  if (context.stopped) {
    return;
  }
  if (isText(node)) {
    collectFlowText(node, context);
    return;
  }
  if (!isElement(node)) {
    if (isParent(node)) {
      for (const child of node.children) {
        collectFlow(child, context);
      }
    }
    return;
  }

  if (INLINE_GROUP_TAGS.has(node.tagName)) {
    const range = nodeRange(node);
    if (!range || range.end > context.safeEnd) {
      context.stopped = true;
      return;
    }

    const kind = node.tagName === "a" ? "link" : "inline";
    context.planner.units.push({
      blockId: context.blockId,
      id: createRangeUnitId(kind, range),
      intervalsAfter: 2,
      kind,
      order: context.planner.nextOrder,
      sourceRange: range,
      value: textContent(node),
    });
    context.planner.nextOrder += 1;

    const inlineContext: FlowContext = {
      ...context,
      // A parsed link or inline-code element already has its closing syntax.
      protectUnsettledMarkup: false,
    };
    for (const child of node.children) {
      collectFlow(child, inlineContext);
    }
    context.stopped = inlineContext.stopped;
    return;
  }

  if (node.tagName === "img") {
    const range = nodeRange(node);
    if (!range || range.end > context.safeEnd) {
      context.stopped = true;
      return;
    }
    addRangeUnit(
      context.planner,
      "image",
      context.blockId,
      range,
      String(node.properties?.alt ?? node.properties?.src ?? ""),
    );
    return;
  }

  for (const child of node.children) {
    collectFlow(child, context);
  }
};

const collectParagraph = (
  block: Element,
  context: PlannerContext,
  confirmed: boolean,
): void => {
  const range = nodeRange(block);
  if (!range) {
    return;
  }

  const blockSource = context.source.slice(range.start, range.end);
  const blockId = `block:${range.start}`;
  if (confirmed) {
    context.confirmedBlockIds.add(blockId);
  }
  const [firstLine = "", secondLine] = blockSource.split(/\r?\n/u);
  const hasUnescapedTablePipe = [...firstLine.matchAll(/\|/gu)].some(
    (match) =>
      match.index !== undefined &&
      !isEscapedAt(context.source, range.start + match.index),
  );
  // A long GFM header can outgrow the ordinary prose lookahead before its
  // separator arrives. Once a viable pipe appears, keep that first line out
  // of the timeline until the next line confirms or rejects the table.
  const secondLineStartsBlockClassifier =
    secondLine !== undefined && /^[\t ]*(?:$|[|=:-])/u.test(secondLine);
  const hasPendingBlockClassifier =
    !confirmed &&
    (secondLineStartsBlockClassifier ||
      (hasUnescapedTablePipe && secondLine === undefined));

  collectFlow(block, {
    blockId,
    planner: context,
    protectUnsettledMarkup: !confirmed,
    safeEnd: confirmed
      ? Number.POSITIVE_INFINITY
      : hasPendingBlockClassifier
        ? range.start
        : Math.max(range.start, context.source.length - FLOW_LOOKAHEAD),
    stopped: false,
  });
};

const collectDirectElements = (
  node: Element,
  tagName: string,
): Element[] => node.children.filter(
  (child): child is Element => isElement(child) && child.tagName === tagName,
);

const collectList = (
  block: Element,
  context: PlannerContext,
  structureConfirmed: boolean,
  contentConfirmed = structureConfirmed,
  inputOpen = false,
): void => {
  const items = collectDirectElements(block, "li");

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    if (context.referenceBlocked) {
      break;
    }
    const item = items[itemIndex];
    if (!item) {
      continue;
    }
    const range = nodeRange(item);
    if (range) {
      const firstUnitIndex = context.units.length;
      const blockId = `block:${range.start}`;
      const referencesStable =
        !inputOpen || !hasUnresolvedReferenceSyntax(item, context.source);
      const itemContentConfirmed =
        referencesStable && (contentConfirmed || itemIndex < items.length - 1);
      if (structureConfirmed && referencesStable) {
        context.confirmedBlockIds.add(blockId);
      }

      const children = item.children;
      const unresolvedChildIndex = referencesStable
        ? -1
        : children.findIndex(
            (child) =>
              isElement(child) &&
              hasUnresolvedReferenceSyntax(child, context.source),
          );
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        if (
          context.referenceBlocked ||
          (unresolvedChildIndex >= 0 && childIndex > unresolvedChildIndex)
        ) {
          break;
        }
        const child = children[childIndex];
        if (!child) {
          continue;
        }
        const isNestedList =
          isElement(child) &&
          (child.tagName === "ul" || child.tagName === "ol");
        if (isNestedList) {
          collectList(
            child,
            context,
            itemContentConfirmed,
            itemContentConfirmed,
            inputOpen,
          );
          continue;
        }

        const hasLaterNestedList = children.slice(childIndex + 1).some(
          (candidate) =>
            isElement(candidate) &&
            (candidate.tagName === "ul" || candidate.tagName === "ol"),
        );
        collectFlow(child, {
          blockId,
          planner: context,
          // A nested list confirms the direct prose that precedes it, even
          // while the containing final item remains open.
          protectUnsettledMarkup:
            !itemContentConfirmed && !hasLaterNestedList,
          safeEnd:
            itemContentConfirmed || hasLaterNestedList
              ? Number.POSITIVE_INFINITY
              : Math.max(range.start, context.source.length - FLOW_LOOKAHEAD),
          stopped: false,
        });
      }
      if (!referencesStable) {
        context.referenceBlocked = true;
      }
      if (itemIndex > 0) {
        // Put list rhythm on the incoming item's first unit. The next marker
        // proves this boundary exists, so an open item's moving safe frontier
        // can never acquire a pause in the middle of its text.
        setFirstUnitIntervalsBefore(
          context,
          firstUnitIndex,
          LIST_ITEM_INTERVALS_BEFORE,
        );
      }
    }
  }
};

const collectTable = (block: Element, context: PlannerContext): void => {
  const blockRange = nodeRange(block);
  if (!blockRange) {
    return;
  }

  for (const section of block.children.filter(isElement)) {
    for (const row of collectDirectElements(section, "tr")) {
      const range = nodeRange(row);
      if (range) {
        const blockId = `block:${range.start}`;
        const firstUnitIndex = context.units.length;
        context.confirmedBlockIds.add(blockId);
        addRangeUnit(
          context,
          "table-row",
          blockId,
          range,
          textContent(row).trim(),
        );
        collectFlow(row, {
          blockId,
          planner: context,
          protectUnsettledMarkup: false,
          safeEnd: Number.POSITIVE_INFINITY,
          stopped: false,
        });
        setLastUnitIntervalsAfter(context, firstUnitIndex, 2);
      }
    }
  }
};

const findCodeValue = (block: Element): string => {
  const code = block.children.find(
    (child): child is Element => isElement(child) && child.tagName === "code",
  );
  return code ? textContent(code) : textContent(block);
};

interface FencedCodeSourceLine {
  readonly sourceRange: SourceRange;
}

const committedFencedCodeLines = (
  blockSource: string,
  blockStart: number,
  inputOpen: boolean,
  insideBlockquote: boolean,
): ReadonlyArray<FencedCodeSourceLine> => {
  const openingLineEnd = blockSource.search(/\r?\n/u);
  if (openingLineEnd === -1) {
    return [];
  }

  const openingLine = blockSource.slice(0, openingLineEnd);
  const opening = openingLine.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  if (!opening) {
    return [];
  }

  const marker = opening[0];
  const minimumFenceLength = opening.length;
  const openingBreakLength = blockSource.startsWith("\r\n", openingLineEnd)
    ? 2
    : 1;
  let cursor = openingLineEnd + openingBreakLength;
  const lines: FencedCodeSourceLine[] = [];

  while (cursor < blockSource.length) {
    const remaining = blockSource.slice(cursor);
    const lineBreak = remaining.match(/\r?\n/u);
    const hasLineBreak = lineBreak !== null;
    const lineEnd = hasLineBreak
      ? cursor + (lineBreak.index ?? 0)
      : blockSource.length;
    const rawLine = blockSource.slice(cursor, lineEnd);
    const prefixLength = insideBlockquote
      ? blockquotePrefixLength(rawLine)
      : 0;
    const line = rawLine.slice(prefixLength);
    const closing = line.match(/^ {0,3}(`+|~+)[\t ]*$/u)?.[1];

    if (
      closing !== undefined &&
      closing[0] === marker &&
      closing.length >= minimumFenceLength
    ) {
      break;
    }

    if (!hasLineBreak && inputOpen) {
      break;
    }

    lines.push({
      sourceRange: {
        end: blockStart + lineEnd,
        start: blockStart + cursor + prefixLength,
      },
    });

    if (!hasLineBreak) {
      break;
    }
    cursor = lineEnd + lineBreak[0].length;
  }

  return lines;
};

const collectCodeBlock = (
  block: Element,
  context: PlannerContext,
  confirmed: boolean,
  inputOpen: boolean,
  insideBlockquote = false,
): void => {
  const range = nodeRange(block);
  if (!range) {
    return;
  }

  const blockId = `block:${range.start}`;
  if (confirmed) {
    context.confirmedBlockIds.add(blockId);
  }

  const value = findCodeValue(block);
  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const blockSource = context.source.slice(range.start, range.end);
  const committedLines = committedFencedCodeLines(
    blockSource,
    range.start,
    inputOpen,
    insideBlockquote,
  );

  committedLines.forEach(({ sourceRange }, lineIndex) => {
    const line = lines[lineIndex] ?? context.source.slice(
      sourceRange.start,
      sourceRange.end,
    );
    context.units.push({
      blockId,
      id: createCodeLineUnitId(range.start, lineIndex),
      intervalsAfter: 2,
      kind: "code-line",
      order: context.nextOrder,
      sourceRange,
      value: line,
    });
    context.nextOrder += 1;

    const characters = segmentGraphemes(line);
    const wordIntervalsAfter = new Map<number, number>();
    if (context.reveal === "word") {
      let characterIndex = 0;
      while (characterIndex < characters.length) {
        if (/^\s+$/u.test(characters[characterIndex]?.value ?? "")) {
          wordIntervalsAfter.set(characterIndex, 0);
          characterIndex += 1;
          continue;
        }
        const wordStart = characterIndex;
        while (
          characterIndex < characters.length &&
          !/^\s+$/u.test(characters[characterIndex]?.value ?? "")
        ) {
          wordIntervalsAfter.set(characterIndex, 0);
          characterIndex += 1;
        }
        const wordLast = characterIndex - 1;
        while (
          characterIndex < characters.length &&
          /^\s+$/u.test(characters[characterIndex]?.value ?? "")
        ) {
          wordIntervalsAfter.set(characterIndex, 0);
          characterIndex += 1;
        }
        wordIntervalsAfter.set(wordLast, characterIndex - wordStart);
      }
    }
    characters.forEach((segment, characterIndex) => {
      const start = Math.min(
        sourceRange.end,
        sourceRange.start + segment.start,
      );
      const end = Math.min(
        sourceRange.end,
        sourceRange.start + segment.end,
      );
      context.units.push({
        blockId,
        id: createCodeCharacterUnitId(
          range.start,
          lineIndex,
          characterIndex,
        ),
        kind: "text",
        ...(context.reveal === "word"
          ? { intervalsAfter: wordIntervalsAfter.get(characterIndex) ?? 0 }
          : {}),
        order: context.nextOrder,
        sourceRange: { end, start },
        value: segment.value,
      });
      context.nextOrder += 1;
    });
  });
};

const isConfirmedContainerBlock = (
  block: Element,
  blockIndex: number,
  blocks: ReadonlyArray<Element>,
  source: string,
  inputOpen: boolean,
  insideBlockquote: boolean,
): boolean => {
  if (!inputOpen || blockIndex < blocks.length - 1) {
    return true;
  }

  const range = nodeRange(block);
  if (!range) {
    return false;
  }

  const tail = source.slice(range.end);
  if (hasBlankLine(tail)) {
    return true;
  }

  if (/^h[1-6]$/u.test(block.tagName) || block.tagName === "hr") {
    return hasLineEnding(tail);
  }

  if (block.tagName === "pre") {
    return hasClosingFence(
      normalizeFencedBlockSource(
        source.slice(range.start, range.end),
        insideBlockquote,
      ),
    );
  }

  return false;
};

const collectHeading = (
  block: Element,
  context: PlannerContext,
): void => {
  const range = nodeRange(block);
  if (!range) {
    return;
  }

  const blockId = `block:${range.start}`;
  const firstUnitIndex = context.units.length;
  context.confirmedBlockIds.add(blockId);
  collectFlow(block, {
    blockId,
    planner: context,
    protectUnsettledMarkup: false,
    safeEnd: Number.POSITIVE_INFINITY,
    stopped: false,
  });
  setLastUnitIntervalsAfter(
    context,
    firstUnitIndex,
    HEADING_INTERVALS_AFTER,
  );
};

const collectBlock = (
  block: Element,
  context: PlannerContext,
  confirmed: boolean,
  inputOpen: boolean,
  insideBlockquote: boolean,
): void => {
  if (context.referenceBlocked) {
    return;
  }
  const range = nodeRange(block);
  if (!range) {
    return;
  }

  if (block.tagName === "p") {
    const referenceUnresolved =
      inputOpen && hasUnresolvedReferenceSyntax(block, context.source);
    collectParagraph(
      block,
      context,
      confirmed && !referenceUnresolved,
    );
    context.referenceBlocked = referenceUnresolved;
    return;
  }
  if (/^h[1-6]$/u.test(block.tagName)) {
    const referenceUnresolved =
      inputOpen && hasUnresolvedReferenceSyntax(block, context.source);
    if (
      confirmed &&
      !referenceUnresolved
    ) {
      collectHeading(block, context);
    }
    context.referenceBlocked = referenceUnresolved;
    return;
  }
  if (block.tagName === "ul" || block.tagName === "ol") {
    collectList(block, context, confirmed, confirmed, inputOpen);
    return;
  }
  if (block.tagName === "table") {
    const referenceUnresolved =
      inputOpen && hasUnresolvedReferenceSyntax(block, context.source);
    if (
      confirmed &&
      !referenceUnresolved
    ) {
      collectTable(block, context);
    }
    context.referenceBlocked = referenceUnresolved;
    return;
  }
  if (block.tagName === "pre") {
    collectCodeBlock(
      block,
      context,
      confirmed,
      inputOpen && !confirmed,
      insideBlockquote,
    );
    return;
  }
  if (block.tagName === "blockquote") {
    const children = block.children.filter(isElement);
    children.forEach((child, childIndex) => {
      if (context.referenceBlocked) {
        return;
      }
      const childConfirmed = confirmed || isConfirmedContainerBlock(
        child,
        childIndex,
        children,
        context.source,
        inputOpen,
        true,
      );
      collectBlock(child, context, childConfirmed, inputOpen, true);
    });
    return;
  }
  if (
    !confirmed ||
    (inputOpen && hasUnresolvedReferenceSyntax(block, context.source))
  ) {
    context.referenceBlocked =
      inputOpen && hasUnresolvedReferenceSyntax(block, context.source);
    return;
  }
  if (block.tagName !== "hr" && textContent(block).length > 0) {
    const blockId = `block:${range.start}`;
    context.confirmedBlockIds.add(blockId);
    collectFlow(block, {
      blockId,
      planner: context,
      protectUnsettledMarkup: false,
      safeEnd: Number.POSITIVE_INFINITY,
      stopped: false,
    });
    return;
  }

  addRangeUnit(
    context,
    "block",
    `block:${range.start}`,
    range,
    textContent(block),
  );
  context.confirmedBlockIds.add(`block:${range.start}`);
};

/**
 * Create an opinionated reveal plan from the complete Markdown received so far.
 *
 * Structural blocks are withheld until append-only input can no longer change
 * their shape. Confirmed blocks are then scheduled as semantic units; prose is
 * the only form allowed to flow before its containing block closes.
 */
export const createMarkdownPlan = (
  tree: Root,
  source: string,
  options: { inputOpen: boolean; reveal?: MarkdownReveal },
): MarkdownPlan => {
  const context: PlannerContext = {
    confirmedBlockIds: new Set(),
    nextOrder: 0,
    referenceBlocked: false,
    reveal: options.reveal ?? "character",
    source,
    units: [],
  };
  const blocks = tree.children.filter(isElement);

  blocks.forEach((block, blockIndex) => {
    const confirmed = isConfirmedRootBlock(
      block,
      blockIndex,
      blocks,
      source,
      options.inputOpen,
    );

    collectBlock(
      block,
      context,
      confirmed,
      options.inputOpen,
      false,
    );
  });

  return {
    confirmedBlockIds: context.confirmedBlockIds,
    tree,
    units: context.units,
  };
};
