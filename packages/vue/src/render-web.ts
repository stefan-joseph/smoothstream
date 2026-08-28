import { find, html, svg } from "property-information";
import {
  defineComponent,
  createTextVNode,
  h,
  onBeforeUnmount,
  ref,
  watch,
  type PropType,
  type VNode,
} from "vue";
import type {
  WebElementNode,
  WebProperties,
  WebRenderNode,
} from "@smoothstream/core/web";

interface VuePropertyInfo {
  readonly commaSeparated: boolean;
  readonly name: string;
}

interface CopyContext {
  readonly copied: boolean;
  readonly copy: (event: MouseEvent) => void;
}

const htmlPropertyInfoByName = new Map<string, VuePropertyInfo>();
const svgPropertyInfoByName = new Map<string, VuePropertyInfo>();
const tableContainers = new Set(["table", "tbody", "tfoot", "thead", "tr"]);

const vuePropertyInfo = (
  property: string,
  namespace: "svg" | undefined,
): VuePropertyInfo => {
  const cache = namespace === "svg"
    ? svgPropertyInfoByName
    : htmlPropertyInfoByName;
  const cached = cache.get(property);
  if (cached) return cached;

  const information = find(namespace === "svg" ? svg : html, property);
  const result = {
    commaSeparated: information.commaSeparated,
    name: information.attribute,
  };
  cache.set(property, result);
  return result;
};

const vueElementProperties = (
  node: WebElementNode,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [property, originalValue] of Object.entries(node.properties)) {
    if (
      property === "children" ||
      originalValue === null ||
      originalValue === undefined ||
      (typeof originalValue === "number" && Number.isNaN(originalValue))
    ) {
      continue;
    }

    const information = vuePropertyInfo(property, node.namespace);
    result[information.name] = Array.isArray(originalValue)
      ? originalValue
        .map(String)
        .join(information.commaSeparated ? ", " : " ")
        .trim()
      : originalValue;
  }
  return result;
};

const writeClipboardText = async (
  button: HTMLButtonElement,
  value: string,
): Promise<void> => {
  const document = button.ownerDocument;
  const view = document.defaultView;
  if (!view) throw new Error("Clipboard copy requires a browser window.");

  if (view.navigator.clipboard?.writeText) {
    await view.navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") === true;
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy is unavailable.");
};

const webChildrenToVue = (
  children: ReadonlyArray<WebRenderNode>,
  filterTableWhitespace: boolean,
  copyContext?: CopyContext,
): VNode[] => children.flatMap((child) => {
  if (
    filterTableWhitespace &&
    child.type === "text" &&
    /^\s*$/u.test(child.value)
  ) {
    return [];
  }
  return [webNodeToVue(child, copyContext)];
});

const webElementToVue = (
  node: WebElementNode,
  copyContext?: CopyContext,
): VNode => {
  const properties = vueElementProperties(node);
  if (copyContext) {
    if (node.properties["data-smoothstream-code-copy"] === true) {
      properties.onClick = copyContext.copy;
      if (copyContext.copied) properties["aria-label"] = "Code copied";
    }
    if (node.properties["data-smoothstream-code-icon-swap"] === true) {
      properties["data-state"] = copyContext.copied ? "check" : "copy";
    }
  }

  return h(
    node.tagName,
    { ...properties, key: node.key },
    webChildrenToVue(
      node.children,
      tableContainers.has(node.tagName),
      copyContext,
    ),
  );
};

const WebCodeBlock = defineComponent({
  name: "SmoothstreamCodeBlock",
  props: {
    node: {
      required: true,
      type: Object as PropType<WebElementNode>,
    },
  },
  setup(props) {
    const copied = ref(false);
    let resetTimer: number | undefined;

    const clearResetTimer = (): void => {
      if (resetTimer === undefined) return;
      const view = typeof window === "undefined" ? undefined : window;
      view?.clearTimeout(resetTimer);
      resetTimer = undefined;
    };

    watch(
      () => props.node.codeCopyValue,
      () => {
        copied.value = false;
        clearResetTimer();
      },
    );

    onBeforeUnmount(clearResetTimer);

    const copy = (event: MouseEvent): void => {
      if (props.node.properties["data-smoothstream-code-copy-ready"] !== true) {
        return;
      }
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button || button.localName !== "button") return;
      const code = props.node.codeCopyValue;
      if (code === undefined) return;
      void writeClipboardText(button, code).then(
        () => {
          copied.value = true;
          clearResetTimer();
          const view = button.ownerDocument.defaultView;
          if (!view) return;
          resetTimer = view.setTimeout(() => {
            copied.value = false;
            resetTimer = undefined;
          }, 2_000);
        },
        () => {
          copied.value = false;
        },
      );
    };

    return () => webElementToVue(props.node, {
      copied: copied.value,
      copy,
    });
  },
});

const webNodeToVue = (
  node: WebRenderNode,
  copyContext?: CopyContext,
): VNode => {
  if (node.type === "text") {
    const text = createTextVNode(node.value);
    text.key = node.key;
    return text;
  }
  if (
    !copyContext &&
    node.tagName === "pre" &&
    node.properties["data-smoothstream-code-block"] === true
  ) {
    return h(WebCodeBlock, { key: node.key, node });
  }
  return webElementToVue(node, copyContext);
};

export const webNodesToVue = (
  nodes: ReadonlyArray<WebRenderNode>,
): VNode[] => nodes.map((node) => webNodeToVue(node));

export type { WebProperties };
