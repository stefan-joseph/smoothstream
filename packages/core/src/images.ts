import type { Element, Node, Parent, Root } from "hast";
import { createRangeUnitId } from "./markdown/identity";

export interface ImageDescriptor {
  readonly id: string;
  readonly src: string;
}

export interface ImageReadiness {
  readonly height?: number;
  readonly readyAt: number;
  readonly status: "error" | "ready";
  readonly width?: number;
}

const isElement = (node: Node): node is Element => node.type === "element";
const isParent = (node: Node): node is Parent => "children" in node;

export const collectImageDescriptors = (
  tree: Root,
): ReadonlyArray<ImageDescriptor> => {
  const result: ImageDescriptor[] = [];
  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === "img") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const src = node.properties?.src;
      if (start !== undefined && end !== undefined && typeof src === "string") {
        result.push({
          id: createRangeUnitId("image", { end, start }),
          src,
        });
      }
    }
    if (isParent(node)) {
      node.children.forEach(visit);
    }
  };
  tree.children.forEach(visit);
  return result;
};
