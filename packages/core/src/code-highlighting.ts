import type { Element, Node, Parent, Root, Text } from "hast";
import type {
  CodeHighlighter,
  CodeHighlightLine,
  CodeHighlightResult,
} from "./code-types";
import type { MarkdownRevealUnit } from "./markdown/types";

export interface ResolvedCodeHighlight extends CodeHighlightResult {
  readonly code: string;
  readonly language: string;
}

export interface CodeBlockRequest {
  readonly blockStart: number;
  readonly code: string;
  readonly language: string;
  readonly lines: ReadonlyArray<string>;
}

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;
const isText = (node: Node): node is Text => node.type === "text";

const textContent = (node: Node): string => {
  if (isText(node)) {
    return node.value;
  }
  if (!isParent(node)) {
    return "";
  }
  return node.children.map(textContent).join("");
};

const codeLanguage = (code: Element): string => {
  const className = code.properties.className;
  const classNames = Array.isArray(className)
    ? className.map(String)
    : className !== null && className !== undefined
      ? String(className).split(/\s+/u)
      : [];
  return classNames.find((value) => value.startsWith("language-"))
    ?.slice("language-".length) ?? "text";
};

const committedLineCounts = (
  units: ReadonlyArray<MarkdownRevealUnit>,
): ReadonlyMap<string, number> => {
  const result = new Map<string, number>();
  for (const unit of units) {
    if (unit.kind === "code-line") {
      result.set(unit.blockId, (result.get(unit.blockId) ?? 0) + 1);
    }
  }
  return result;
};

export const collectCodeBlockRequests = (
  tree: Root,
  units: ReadonlyArray<MarkdownRevealUnit>,
): ReadonlyArray<CodeBlockRequest> => {
  const lineCounts = committedLineCounts(units);
  const requests: CodeBlockRequest[] = [];

  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === "pre") {
      const blockStart = node.position?.start.offset;
      const code = node.children.find(
        (child): child is Element => isElement(child) && child.tagName === "code",
      );
      if (blockStart === undefined || !code) {
        return;
      }

      const lineCount = lineCounts.get(`block:${blockStart}`) ?? 0;
      if (lineCount === 0) {
        return;
      }

      const lines = textContent(code).split("\n");
      if (lines.at(-1) === "") {
        lines.pop();
      }
      const committedLines = lines.slice(0, lineCount);
      requests.push({
        blockStart,
        code: `${committedLines.join("\n")}\n`,
        language: codeLanguage(code),
        lines: committedLines,
      });
      return;
    }

    if (isParent(node)) {
      node.children.forEach(visit);
    }
  };

  visit(tree);
  return requests;
};

export const codeBlockRequestKey = (request: CodeBlockRequest): string =>
  `${request.language}\u0000${request.code}`;

export const plainCodeLines = (
  lines: ReadonlyArray<string>,
): ReadonlyArray<CodeHighlightLine> => lines.map((line) => ({
  tokens: line.length === 0 ? [] : [{ content: line }],
}));

export const normalizeCodeHighlight = (
  result: CodeHighlightResult,
  expectedLines: ReadonlyArray<string>,
): ReadonlyArray<CodeHighlightLine> => expectedLines.map(
  (expected, index) => {
    const line = result.lines[index];
    if (!line || line.tokens.map((token) => token.content).join("") !== expected) {
      return plainCodeLines([expected])[0] ?? { tokens: [] };
    }
    return line;
  },
);

export const resolveCodeHighlight = (
  request: CodeBlockRequest,
  result: CodeHighlightResult | undefined,
  previous?: ResolvedCodeHighlight,
): ResolvedCodeHighlight => {
  const lines = result
    ? normalizeCodeHighlight(result, request.lines)
    : plainCodeLines(request.lines);
  const stableLines = previous?.language === request.language &&
      request.code.startsWith(previous.code)
    ? [
        ...previous.lines,
        ...lines.slice(previous.lines.length),
      ]
    : lines;
  const languageLabel = previous
    ? previous.languageLabel
    : result?.languageLabel;
  const palette = previous ? previous.palette : result?.palette;

  return {
    code: request.code,
    language: request.language,
    lines: stableLines,
    ...(languageLabel ? { languageLabel } : {}),
    ...(palette ? { palette } : {}),
  };
};

const codeLineIndex = (unit: MarkdownRevealUnit): number | undefined => {
  if (unit.kind !== "code-line") {
    return undefined;
  }
  const match = unit.id.match(/^code-line:\d+:(\d+)$/u);
  return match ? Number(match[1]) : undefined;
};

export const unitsReadyForCodeHighlights = (
  units: ReadonlyArray<MarkdownRevealUnit>,
  highlighter: CodeHighlighter | undefined,
  highlights: ReadonlyMap<number, ResolvedCodeHighlight>,
): ReadonlyArray<MarkdownRevealUnit> => {
  if (!highlighter) {
    return units;
  }

  const blockedAt = units.findIndex((unit) => {
    const lineIndex = codeLineIndex(unit);
    if (lineIndex === undefined) {
      return false;
    }
    const blockStart = Number(unit.blockId.slice("block:".length));
    return highlights.get(blockStart)?.lines[lineIndex] === undefined;
  });
  return blockedAt === -1 ? units : units.slice(0, blockedAt);
};
