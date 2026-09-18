import type { Element, Node, Parent, Root } from "hast";
import type { Nodes as MdastNode, Root as MdastRoot } from "mdast";
import { createRangeUnitId } from "./identity";

interface Definition {
  readonly end: number;
  readonly ready: boolean;
  readonly start: number;
}

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;
const normalizeIdentifier = (value: string): string =>
  value.trim().replaceAll(/\s+/gu, " ").toLowerCase();

const isEscapedAt = (source: string, offset: number): boolean => {
  let count = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
};

/**
 * A GFM reference is parsed only once its definition exists. During an open
 * stream, supply empty definitions to reserve stable reference markup while
 * allowing the prose after a late reference to continue revealing.
 */
export const provisionalFootnoteDefinitions = (
  tree: MdastRoot,
  source: string,
): ReadonlyArray<string> => {
  if (!source.includes("[^")) return [];
  const definitions = new Set<string>();
  for (const child of tree.children) {
    if (child.type === "footnoteDefinition") {
      definitions.add(normalizeIdentifier(child.identifier));
    }
  }

  const candidates = new Map<string, string>();
  const visit = (node: MdastNode): void => {
    if (node.type === "text") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = source.slice(start, end);
      for (const match of raw.matchAll(/\[\^([^\[\]\s]{1,200})\]/gu)) {
        const offset = start + (match.index ?? 0);
        if (isEscapedAt(source, offset)) continue;
        const label = match[1] ?? "";
        const identifier = normalizeIdentifier(label);
        if (!definitions.has(identifier) && !candidates.has(identifier)) {
          candidates.set(identifier, label);
        }
      }
      return;
    }
    if ("children" in node) {
      node.children.forEach((child) => visit(child as MdastNode));
    }
  };
  visit(tree);
  return [...candidates.values()];
};

const realDefinitions = (
  tree: MdastRoot,
  source: string,
  inputOpen: boolean,
): ReadonlyMap<string, Definition> => {
  const result = new Map<string, Definition>();
  tree.children.forEach((node, index) => {
    if (node.type !== "footnoteDefinition") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const identifier = normalizeIdentifier(node.identifier);
    if (result.has(identifier)) return;
    result.set(identifier, {
      end,
      ready: !inputOpen || index < tree.children.length - 1 ||
        /^(?:\r?\n)[\t ]*(?:\r?\n)/u.test(source.slice(end)),
      start,
    });
  });
  return result;
};

const referenceIdentifiers = (tree: MdastRoot): ReadonlyMap<number, string> => {
  const result = new Map<number, string>();
  const visit = (node: MdastNode): void => {
    if (node.type === "footnoteReference") {
      const start = node.position?.start.offset;
      if (start !== undefined) {
        result.set(start, normalizeIdentifier(node.identifier));
      }
    }
    if ("children" in node) {
      node.children.forEach((child) => visit(child as MdastNode));
    }
  };
  visit(tree);
  return result;
};

const footnoteSection = (tree: Root): Element | undefined =>
  tree.children.find((node): node is Element =>
    isElement(node) && node.tagName === "section" &&
    node.properties.dataFootnotes === true
  );

const descendantElements = (node: Node): Element[] => {
  const result: Element[] = [];
  const visit = (child: Node): void => {
    if (isElement(child)) result.push(child);
    if (isParent(child)) child.children.forEach(visit);
  };
  visit(node);
  return result;
};

/** Normalize sanitizer-prefixed IDs and scope every generated footnote target. */
const scopeFootnoteIds = (tree: Root, prefix: string): void => {
  const section = footnoteSection(tree);
  if (!section) return;
  const references = descendantElements(tree).filter((node) =>
    node.properties.dataFootnoteRef === true
  );
  const ids = [...references, ...descendantElements(section)];
  const aliases = new Map<string, string>();
  for (const node of ids) {
    const id = node.properties.id;
    if (typeof id !== "string") continue;
    const canonical = id.startsWith("user-content-user-content-")
      ? id.slice("user-content-".length)
      : id;
    const scoped = `${prefix}${canonical}`;
    aliases.set(id, scoped);
    aliases.set(canonical, scoped);
  }

  const visit = (node: Node): void => {
    if (isElement(node)) {
      const id = node.properties.id;
      if (typeof id === "string" && aliases.has(id)) {
        node.properties.id = aliases.get(id);
      }
      const href = node.properties.href;
      if (typeof href === "string" && href.startsWith("#")) {
        const target = aliases.get(href.slice(1));
        if (target) node.properties.href = `#${target}`;
      }
      const describedBy = node.properties.ariaDescribedBy;
      if (Array.isArray(describedBy)) {
        node.properties.ariaDescribedBy = describedBy.map((value) =>
          aliases.get(String(value)) ?? value
        );
      }
    }
    if (isParent(node)) node.children.forEach(visit);
  };
  visit(tree);
};

/** Attach source-backed readiness to footnotes generated by remark-rehype. */
export const prepareFootnotes = (
  tree: Root,
  markdown: MdastRoot,
  original: MdastRoot,
  source: string,
  inputOpen: boolean,
  idPrefix: string,
): Root => {
  const section = footnoteSection(tree);
  if (!section) return tree;
  const definitions = realDefinitions(original, source, inputOpen);
  const definitionsByStart = new Map(
    [...definitions.values()].map((definition) => [definition.start, definition]),
  );
  const references = referenceIdentifiers(markdown);

  for (const element of descendantElements(tree)) {
    if (element.properties.dataFootnoteRef !== true) continue;
    const start = element.position?.start.offset;
    const identifier = start === undefined ? undefined : references.get(start);
    const definition = identifier ? definitions.get(identifier) : undefined;
    if (!definition?.ready) {
      element.properties["data-smoothstream-footnote-pending"] = true;
    } else {
      element.properties["data-smoothstream-footnote-target"] = createRangeUnitId(
        "footnote",
        { start: definition.start, end: definition.end },
      );
    }
  }

  const list = section.children.find((node): node is Element =>
    isElement(node) && node.tagName === "ol"
  );
  if (!list) return tree;
  let footnoteOrdinal = 0;
  list.children = list.children.filter((node) => {
    if (!isElement(node) || node.tagName !== "li") return true;
    footnoteOrdinal += 1;
    const start = node.position?.start.offset;
    const definition = start === undefined
      ? undefined
      : definitionsByStart.get(start);
    if (!definition) return false;
    node.properties.value = String(footnoteOrdinal);
    node.properties["data-smoothstream-footnote-definition"] = true;
    node.properties["data-smoothstream-footnote-ready"] = definition.ready;
    return true;
  });
  scopeFootnoteIds(tree, idPrefix);
  if (!list.children.some((node) =>
    isElement(node) && node.tagName === "li"
  )) {
    tree.children = tree.children.filter((node) => node !== section);
    return tree;
  }
  return tree;
};
