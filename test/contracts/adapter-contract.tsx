import type {
  CodeHighlighter,
  CodeHighlightResult,
} from "@smoothstream/core";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdown } from "../../packages/core/src/markdown/parse";
import { markdownCases } from "../fixtures/markdown-cases";

export interface AdapterContractOptions {
  readonly className?: string;
  readonly codeHighlighter?: CodeHighlighter;
  readonly duration?: number;
  readonly interval?: number;
  readonly mode?: "static" | "streaming";
  readonly receiving?: boolean;
  readonly reducedMotion?: "always" | "never" | "system";
  readonly reveal?: "character" | "word";
  readonly unstyled?: boolean;
}

export interface AdapterContractDriver {
  readonly element: HTMLElement;
  destroy(): void;
  flush(): Promise<void>;
  update(
    source: string,
    options?: { readonly receiving?: boolean },
  ): Promise<void>;
}

export interface AdapterContract {
  readonly name: string;
  mount(
    source: string,
    options?: AdapterContractOptions,
  ): Promise<AdapterContractDriver>;
}

const renderStaticMarkdown = (source: string): string =>
  renderToStaticMarkup(
    toJsxRuntime(parseMarkdown(source), {
      Fragment,
      jsx,
      jsxs,
      passKeys: true,
    }),
  );

const normalizeSemanticHtml = (html: string): string => {
  const container = document.createElement("div");
  container.innerHTML = html;

  for (const preload of container.querySelectorAll(
    'link[rel="preload"][as="image"]',
  )) {
    preload.remove();
  }
  for (const wrapper of container.querySelectorAll(
    "[data-smoothstream-table-shell], [data-smoothstream-table-scroll]",
  )) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const table of container.querySelectorAll("table")) {
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    const whitespace: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.trim() === "") whitespace.push(node);
    }
    whitespace.forEach((node) => node.remove());
  }
  for (const cell of container.querySelectorAll<HTMLElement>("th, td")) {
    const alignment = cell.getAttribute("align") ?? cell.style.textAlign;
    cell.removeAttribute("align");
    cell.style.removeProperty("text-align");
    if (alignment) cell.setAttribute("data-contract-align", alignment);
  }
  for (const image of container.querySelectorAll<HTMLElement>(
    "[data-smoothstream-image-standalone], [data-smoothstream-image]",
  )) {
    image.removeAttribute("data-smoothstream-image-standalone");
    image.removeAttribute("data-smoothstream-image");
    image.removeAttribute("decoding");
    image.removeAttribute("height");
    image.removeAttribute("width");
  }
  for (const element of container.querySelectorAll<HTMLElement>("*")) {
    if (element.hasAttribute("style")) {
      const style = element.style.cssText;
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
    }
    const attributes = [...element.attributes]
      .map(({ name, value }) => ({ name, value }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const { name } of attributes) element.removeAttribute(name);
    for (const { name, value } of attributes) element.setAttribute(name, value);
  }
  return container.innerHTML;
};

const installImmediateImage = (): void => {
  class ImmediateImage {
    complete = false;
    decoding = "auto";
    naturalHeight = 360;
    naturalWidth = 640;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    #src = "";

    get src(): string {
      return this.#src;
    }

    set src(value: string) {
      this.#src = value;
      this.complete = true;
      this.onload?.();
    }

    decode(): Promise<void> {
      return Promise.resolve();
    }
  }

  vi.stubGlobal("Image", ImmediateImage);
};

const expectSemanticMarkdown = (element: HTMLElement, source: string): void => {
  expect(element.querySelectorAll("[data-smoothstream-unit]")).toHaveLength(0);
  expect(normalizeSemanticHtml(element.innerHTML)).toBe(
    normalizeSemanticHtml(renderStaticMarkdown(source)),
  );
};

export const runAdapterContract = ({ name, mount }: AdapterContract): void => {
  describe(`${name} shared adapter contract`, () => {
    it.each(markdownCases)(
      "$name settles to ordinary semantic Markdown HTML",
      async ({ markdown }) => {
        installImmediateImage();
        const driver = await mount(markdown, {
          mode: "static",
          reducedMotion: "never",
        });
        try {
          await driver.flush();
          expectSemanticMarkdown(driver.element, markdown);
        } finally {
          driver.destroy();
        }
      },
    );

    it("converges after the same append-only streaming updates", async () => {
      const chunks = [
        "# Shared contract\n\nA ",
        "**streamed** sentence with ",
        "`inline code`.\n\n- First item\n",
        "- Second item\n",
      ];
      let source = "";
      const driver = await mount(source, {
        receiving: true,
        reducedMotion: "always",
      });
      try {
        for (const chunk of chunks) {
          source += chunk;
          await driver.update(source, { receiving: true });
        }
        await driver.update(source, { receiving: false });
        await driver.flush();
        expectSemanticMarkdown(driver.element, source);
      } finally {
        driver.destroy();
      }
    });

    it("honors the shared static presentation options", async () => {
      const driver = await mount("Static **content**.", {
        className: "contract-class",
        duration: 420,
        interval: 7,
        mode: "static",
        reducedMotion: "never",
        reveal: "word",
        unstyled: true,
      });
      try {
        await driver.flush();
        expect(driver.element).toHaveClass("contract-class");
        expect(driver.element).toHaveAttribute(
          "data-smoothstream-mode",
          "static",
        );
        expect(driver.element).toHaveAttribute(
          "data-smoothstream-motion",
          "animate",
        );
        expect(driver.element).toHaveAttribute(
          "data-smoothstream-reveal",
          "word",
        );
        expect(driver.element).not.toHaveAttribute("data-smoothstream-theme");
        expect(
          driver.element.style.getPropertyValue("--smoothstream-duration"),
        ).toBe("420ms");
        expect(
          driver.element.style.getPropertyValue("--smoothstream-interval"),
        ).toBe("7ms");
        expect(
          document.querySelector("[data-smoothstream-announcer]"),
        ).toBeNull();
      } finally {
        driver.destroy();
      }
    });

    it.each([
      {
        name: "static mode",
        options: { mode: "static", reducedMotion: "never" },
      },
      {
        name: "reduced motion",
        options: { reducedMotion: "always" },
      },
    ] as const)(
      "renders unresolved resources immediately with $name",
      async ({ options }) => {
        class UnexpectedImageLoader {
          static readonly instances: UnexpectedImageLoader[] = [];

          constructor() {
            UnexpectedImageLoader.instances.push(this);
          }
        }
        vi.stubGlobal("Image", UnexpectedImageLoader);
        const highlight = vi.fn(
          () => new Promise<CodeHighlightResult>(() => undefined),
        );
        const source = [
          "Before the code.",
          "",
          "```ts",
          "const ready = true;",
          "```",
          "",
          "![Diagram](/diagram.svg)",
          "",
          "After the resources.",
        ].join("\n");
        const driver = await mount(source, {
          ...options,
          codeHighlighter: {
            highlight,
            name: "pending-contract-highlighter",
          },
        });

        try {
          expect(highlight).toHaveBeenCalledOnce();
          expect(driver.element).toHaveTextContent("Before the code.");
          expect(driver.element.querySelector("pre code")).toHaveTextContent(
            "const ready = true;",
          );
          const pre = driver.element.querySelector(
            "pre[data-smoothstream-code-block]",
          );
          const toolbar = pre?.querySelector(
            "[data-smoothstream-code-toolbar]",
          );
          const language = pre?.querySelector(
            "[data-smoothstream-code-language]",
          );
          const copyButton = pre?.querySelector(
            "button[data-smoothstream-code-copy]",
          );
          expect(pre).not.toBeNull();
          expect(toolbar?.parentElement).toBe(pre);
          expect(language).toBeEmptyDOMElement();
          expect(copyButton).toBeEnabled();
          expect(copyButton).toHaveAttribute("data-smoothstream-ready", "true");
          expect(copyButton).toHaveAccessibleName("Copy code");
          expect(copyButton).not.toHaveAttribute("aria-hidden");
          expect(driver.element).toHaveTextContent("After the resources.");
          expect(driver.element.querySelector("[data-smoothstream-code-token]"))
            .toBeNull();
          const image = driver.element.querySelector("img");
          expect(image).toHaveAttribute("src", "/diagram.svg");
          expect(image).toHaveAttribute("alt", "Diagram");
          expect(image).not.toHaveAttribute("aria-hidden");
          expect(image).not.toHaveAttribute("data-smoothstream-image");
          expect(image).not.toHaveStyle({ visibility: "hidden" });
          expect(UnexpectedImageLoader.instances).toHaveLength(0);
          expect(driver.element.querySelector("[data-smoothstream-unit]"))
            .toBeNull();
        } finally {
          driver.destroy();
        }
      },
    );

    it("announces a completed streaming response and removes its announcer", async () => {
      const source = "A completed response.";
      const driver = await mount(source, {
        receiving: true,
        reducedMotion: "always",
      });
      expect(driver.element).toHaveAttribute(
        "data-smoothstream-motion",
        "none",
      );
      expect(
        driver.element.style.getPropertyValue("--smoothstream-duration"),
      ).toBe("0ms");
      expect(
        driver.element.style.getPropertyValue("--smoothstream-interval"),
      ).toBe("0ms");
      const announcer = document.querySelector("[data-smoothstream-announcer]");
      expect(announcer).toHaveAttribute("aria-live", "polite");
      expect(announcer).toHaveAttribute("aria-atomic", "true");
      expect(announcer).toHaveAttribute("role", "status");
      expect(announcer).toBeEmptyDOMElement();

      await driver.update(source, { receiving: false });
      await driver.flush();
      expect(announcer).toHaveTextContent("Content ready.");

      driver.destroy();
      expect(
        document.querySelector("[data-smoothstream-announcer]"),
      ).toBeNull();
    });

    it("waits for image decoding without blocking later content", async () => {
      let resolveDecode: (() => void) | undefined;
      class ControlledImage {
        static readonly instances: ControlledImage[] = [];
        complete = false;
        decoding = "auto";
        naturalHeight = 0;
        naturalWidth = 0;
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        src = "";
        readonly decode = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveDecode = resolve;
            }),
        );

        constructor() {
          ControlledImage.instances.push(this);
        }
      }
      vi.stubGlobal("Image", ControlledImage);

      const driver = await mount("![Diagram](/diagram.svg)\n\nLater content.", {
        duration: 0,
        interval: 0,
        reducedMotion: "never",
      });
      try {
        const pendingImage = driver.element.querySelector("img");
        expect(pendingImage).toHaveAttribute(
          "data-smoothstream-image",
          "pending",
        );
        expect(driver.element).toHaveTextContent("Later content.");

        const request = ControlledImage.instances[0];
        if (!request) throw new Error("Expected an image preload request.");
        request.complete = true;
        request.naturalWidth = 640;
        request.naturalHeight = 360;
        request.onload?.();
        await Promise.resolve();

        expect(request.decode).toHaveBeenCalledOnce();
        expect(driver.element.querySelector("img")).toHaveAttribute(
          "data-smoothstream-image",
          "pending",
        );

        resolveDecode?.();
        await driver.flush();
        const readyImage = driver.element.querySelector("img");
        expect(readyImage).not.toHaveAttribute(
          "data-smoothstream-image",
          "pending",
        );
        expect(readyImage).not.toHaveAttribute("aria-hidden");
      } finally {
        driver.destroy();
      }
    });

    it("renders the shared syntax-highlighter result", async () => {
      const highlight = vi.fn(() => ({
        languageLabel: "TypeScript",
        lines: [
          {
            tokens: [
              { content: "const", style: { color: "#c00000" } },
              { content: " ready = true;" },
            ],
          },
        ],
        palette: {
          backgroundColor: "#f5f5f5",
          color: "#202020",
        },
      }));
      const highlighter: CodeHighlighter = {
        highlight,
        name: "contract-highlighter",
      };
      const source = "```ts\nconst ready = true;\n```";
      const driver = await mount(source, {
        codeHighlighter: highlighter,
        mode: "static",
        reducedMotion: "never",
      });
      try {
        await driver.flush();
        expect(highlight).toHaveBeenCalledWith({
          code: "const ready = true;\n",
          language: "ts",
          session: expect.any(Object),
        });
        const pre = driver.element.querySelector(
          "pre[data-smoothstream-code-block]",
        );
        expect(pre).toHaveAttribute(
          "data-smoothstream-code-label",
          "TypeScript",
        );
        expect(
          pre?.querySelector("[data-smoothstream-code-language]"),
        ).toHaveTextContent("TypeScript");
        expect(pre?.querySelector("code")).toHaveTextContent(
          "const ready = true;",
        );
        expect(
          pre?.querySelector("[data-smoothstream-code-token]"),
        ).toHaveStyle({ color: "rgb(192, 0, 0)" });
        expect(
          pre?.querySelector("[data-smoothstream-code-copy]"),
        ).toHaveAttribute("data-smoothstream-ready", "true");
      } finally {
        driver.destroy();
      }
    });

    it("mounts enabled canonical copying when streamed code is complete", async () => {
      const originalClipboard = Object.getOwnPropertyDescriptor(
        window.navigator,
        "clipboard",
      );
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      const highlighter: CodeHighlighter = {
        highlight: (request) => ({
          lines: request.code.split("\n").slice(0, -1).map((line: string) => ({
            tokens: [{ content: line }],
          })),
        }),
        name: "copy-readiness-contract-highlighter",
      };
      const open = "```ts\nfirst();\nsecond();\n";
      const complete = `${open}\`\`\``;
      const driver = await mount(open, {
        codeHighlighter: highlighter,
        receiving: true,
        reducedMotion: "always",
      });

      try {
        const pendingPre = driver.element.querySelector(
          "pre[data-smoothstream-code-block]",
        );
        const pendingSlot = driver.element.querySelector(
          "[data-smoothstream-code-copy-slot]",
        );
        const pending = driver.element.querySelector<HTMLButtonElement>(
          "[data-smoothstream-code-copy]",
        );
        expect(pendingSlot).not.toBeNull();
        expect(pending).toBeNull();

        await driver.update(complete, { receiving: true });
        const readyPre = driver.element.querySelector(
          "pre[data-smoothstream-code-block]",
        );
        const readySlot = driver.element.querySelector(
          "[data-smoothstream-code-copy-slot]",
        );
        const ready = driver.element.querySelector<HTMLButtonElement>(
          "[data-smoothstream-code-copy]",
        );
        expect(readyPre).toBe(pendingPre);
        expect(readySlot).toBe(pendingSlot);
        expect(ready?.parentElement).toBe(readySlot);
        expect(ready).toBeVisible();
        expect(ready).toBeEnabled();
        expect(ready).toHaveAttribute("data-smoothstream-ready", "true");

        ready?.click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith("first();\nsecond();");
      } finally {
        driver.destroy();
        if (originalClipboard) {
          Object.defineProperty(
            window.navigator,
            "clipboard",
            originalClipboard,
          );
        } else {
          delete (window.navigator as unknown as Record<string, unknown>)
            .clipboard;
        }
      }
    });

    it("hides language labels without removing highlighting or the copy control", async () => {
      const highlighter: CodeHighlighter = {
        highlight: () => ({
          languageLabel: "TypeScript",
          lines: [{ tokens: [{ content: "const ready = true;" }] }],
        }),
        name: "hidden-label-contract-highlighter",
        showLanguageLabels: false,
      };
      const driver = await mount("```ts\nconst ready = true;\n```", {
        codeHighlighter: highlighter,
        mode: "static",
      });

      try {
        await driver.flush();
        const pre = driver.element.querySelector(
          "pre[data-smoothstream-code-block]",
        );
        expect(pre).toHaveAttribute("data-smoothstream-code-language-hidden");
        expect(pre).toHaveAttribute("data-smoothstream-code-single-line");
        expect(pre).toHaveAttribute("data-smoothstream-code-label", "");
        expect(pre?.querySelector("[data-smoothstream-code-language]"))
          .toBeEmptyDOMElement();
        expect(pre?.querySelector("code")).toHaveTextContent(
          "const ready = true;",
        );
        expect(pre?.querySelector("[data-smoothstream-code-copy]"))
          .toHaveAccessibleName("Copy code");
      } finally {
        driver.destroy();
      }
    });
  });
};
