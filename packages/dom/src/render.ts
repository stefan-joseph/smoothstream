import {
  createWebPresentationCache,
  createWebPresentation,
  type WebPresentationCache,
  type WebPresentationState,
  type WebProperties,
  type WebRenderNode,
} from "@smoothstream/core/web";
import { find, html, svg } from "property-information";

type DomSpec = WebRenderNode;
type Properties = WebProperties;

const domNodeKeys = new WeakMap<Node, string>();
const presentationCaches = new WeakMap<HTMLElement, WebPresentationCache>();
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

export const renderDom = (
  root: HTMLElement,
  state: WebPresentationState,
): void => {
  let cache = presentationCaches.get(root);
  if (!cache) {
    cache = createWebPresentationCache();
    presentationCaches.set(root, cache);
  }
  reconcileChildren(root, createWebPresentation({ ...state, cache }));
};
