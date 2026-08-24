import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const baseCssUrl = new URL(
  "../packages/styles/base.css",
  import.meta.url,
);
const themeCssUrl = new URL(
  "../packages/styles/styles.css",
  import.meta.url,
);

describe("stylesheet contract", () => {
  it("keeps reveal mechanics in the automatic base stylesheet", async () => {
    const css = await readFile(baseCssUrl, "utf8");

    expect(css).toContain("@keyframes smoothstream-text-in");
    expect(css).toContain(
      '[data-smoothstream-mode="streaming"][data-smoothstream-motion="animate"]',
    );
    expect(css).toContain("font-kerning: none");
    expect(css).toMatch(
      /@keyframes smoothstream-rule-in \{[\s\S]*?scaleX\(0\)[\s\S]*?scaleX\(1\)/,
    );
    expect(css).toContain('[data-smoothstream-kind="text"]');
    expect(css).toContain("[data-smoothstream-remainder]");
    expect(css).toContain("content: attr(data-smoothstream-remainder)");
    expect(css).toContain("visibility: hidden");
    expect(css).toMatch(
      /\[data-smoothstream-kind="block"\] \{[\s\S]*?transform-origin: center;[\s\S]*?var\(--smoothstream-duration, 1200ms\)[\s\S]*?cubic-bezier\(0\.16, 1, 0\.3, 1\)/,
    );
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("[data-smoothstream-code-copy]");
    expect(css).toContain("pre[data-smoothstream-code-block]");
    expect(css).toContain("[data-smoothstream-code-toolbar]");
    expect(css).toContain("justify-content: space-between");
    expect(css).toMatch(
      /\[data-smoothstream-code-language\] \{[\s\S]*?font-size: 0\.875em;/,
    );
    expect(css).toContain("--smoothstream-shiki-background");
    expect(css).toMatch(
      /pre\[data-smoothstream-code-block\] \{[\s\S]*?font-family: inherit;[\s\S]*?font-size: inherit;/,
    );
    expect(css).toMatch(
      /pre\[data-smoothstream-code-block\] > code \{[\s\S]*?overflow-x: auto;/,
    );
    expect(css).not.toContain("ui-monospace");
    expect(css).not.toContain("--smoothstream-font-mono");
    expect(css).not.toContain("--smoothstream-code-font-size");
    expect(css).not.toContain("--smoothstream-inline-code-font-size");
    expect(css).toContain("[data-smoothstream-code-icon-swap]");
    expect(css).toMatch(
      /\[data-smoothstream-code-icon\] \{[\s\S]*?inline-size: 1rem;[\s\S]*?block-size: 1rem;/,
    );
    expect(css).toContain("--smoothstream-icon-swap-duration");
    expect(css).toContain('[data-smoothstream-ready="true"]');
    expect(css).toContain("[data-smoothstream-table-shell]");
    expect(css).toContain("[data-smoothstream-table-scroll]");
    expect(css).toContain("width: fit-content");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("overscroll-behavior-inline: contain");
    expect(css).toMatch(
      /\[data-smoothstream-table-scroll\] th \{[\s\S]*?white-space: nowrap;/,
    );
    expect(css).not.toContain("smoothstream-theme");
  });

  it("keeps the default theme scoped, optional, and reset-resilient", async () => {
    const css = await readFile(themeCssUrl, "utf8");
    const cssWithoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

    expect(css).not.toContain("@layer");
    expect(css).toContain(
      ':where([data-smoothstream-theme="default"])',
    );
    expect(css).toMatch(
      /theme="default"\]\) \{[\s\S]*?line-height: 1\.625;/,
    );
    expect(css).not.toContain(":where([data-smoothstream])");
    expect(css).toContain("--smoothstream-foreground: currentColor");
    expect(css).toContain(
      "--smoothstream-body-color: var(--smoothstream-foreground)",
    );
    expect(css).not.toContain("--smoothstream-foreground: #171717");
    expect(css).toContain("color-mix(");
    expect(css).toContain("--smoothstream-link-color");
    expect(css).toContain(
      "--smoothstream-bullet-color: var(--smoothstream-body-color)",
    );
    expect(css).toContain(
      "--smoothstream-counter-color: var(--smoothstream-body-color)",
    );
    expect(css).toMatch(
      /ol > li\)::marker \{[\s\S]*?font-weight: 700;/,
    );
    expect(css).toContain("--smoothstream-inline-code-color");
    expect(css).toContain("--smoothstream-code-background");
    expect(css).toContain("--smoothstream-code-padding-inline: 1rem");
    expect(css).toContain("--smoothstream-code-margin-block: 0.75em");
    expect(css).toContain("--smoothstream-p-margin-block-start: 0.5em");
    expect(css).toContain("--smoothstream-p-margin-block-end: 1em");
    expect(css).toMatch(
      /theme="default"\] p\) \{[\s\S]*?margin-block-start: var\(--smoothstream-p-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-p-margin-block-end\);/,
    );
    expect(css).toContain("--smoothstream-ul-margin-block-start: 0.5em");
    expect(css).toContain("--smoothstream-ul-margin-block-end: 1em");
    expect(css).toContain("--smoothstream-ol-margin-block-start: 0.5em");
    expect(css).toContain("--smoothstream-ol-margin-block-end: 1em");
    expect(css).toMatch(
      /theme="default"\] ul\) \{[\s\S]*?margin-block-start: var\(--smoothstream-ul-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-ul-margin-block-end\);[\s\S]*?list-style-type: disc;/,
    );
    expect(css).toMatch(
      /theme="default"\] ol\) \{[\s\S]*?margin-block-start: var\(--smoothstream-ol-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-ol-margin-block-end\);/,
    );
    expect(css).toContain("--smoothstream-ul-li-margin-block: 0.25em");
    expect(css).toContain("--smoothstream-ol-li-margin-block: 0.25em");
    expect(css).toMatch(
      /theme="default"\] ul > li\) \{[\s\S]*?margin-block: var\(--smoothstream-ul-li-margin-block\);/,
    );
    expect(css).toMatch(
      /theme="default"\] ol > li\) \{[\s\S]*?margin-block: var\(--smoothstream-ol-li-margin-block\);/,
    );
    expect(css).toContain("--smoothstream-li-ul-margin-block: 0.25em");
    expect(css).toContain("--smoothstream-li-ol-margin-block: 0.25em");
    expect(css).toMatch(
      /li > ul\) \{[\s\S]*?margin-block: var\(--smoothstream-li-ul-margin-block\);/,
    );
    expect(css).toMatch(
      /li > ol\) \{[\s\S]*?margin-block: var\(--smoothstream-li-ol-margin-block\);/,
    );
    expect(css).toContain("--smoothstream-blockquote-margin-block: 1em");
    expect(css).toMatch(
      /theme="default"\] blockquote\) \{[\s\S]*?margin-block: var\(--smoothstream-blockquote-margin-block\);/,
    );
    expect(css).toMatch(
      /:is\(ul, ol\) > li > p:first-child\) \{[\s\S]*?margin-block-start: 0;/,
    );
    expect(css).toContain("--smoothstream-hr-margin-block: 1.75em");
    expect(css).toMatch(
      /theme="default"\] hr\) \{[\s\S]*?margin-block: var\(--smoothstream-hr-margin-block\);/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h1-margin-block-start \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h1-margin-block-end \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toContain("--smoothstream-h1-margin-block-start: 1.5em");
    expect(css).toContain("--smoothstream-h1-margin-block-end: 0.5em");
    expect(css).toMatch(
      /@property --smoothstream-h2-margin-block-start \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h2-margin-block-end \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toContain("--smoothstream-h2-margin-block-start: 1.5em");
    expect(css).toContain("--smoothstream-h2-margin-block-end: 0.25em");
    expect(css).toMatch(
      /@property --smoothstream-h3-margin-block-start \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h3-margin-block-end \{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(css).toContain("--smoothstream-h3-margin-block-start: 1.25em");
    expect(css).toContain("--smoothstream-h3-margin-block-end: 0.25em");
    expect(css).toMatch(
      /@property --smoothstream-h4-margin-block-start \{[\s\S]*?syntax: "<length>";/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h5-margin-block-start \{[\s\S]*?syntax: "<length>";/,
    );
    expect(css).toMatch(
      /@property --smoothstream-h6-margin-block-start \{[\s\S]*?syntax: "<length>";/,
    );
    expect(css).toContain("--smoothstream-h4-margin-block-start: 1em");
    expect(css).toContain("--smoothstream-h4-margin-block-end: 0.25em");
    expect(css).toContain("--smoothstream-h5-margin-block-start: 1em");
    expect(css).toContain("--smoothstream-h5-margin-block-end: 0.25em");
    expect(css).toContain("--smoothstream-h6-margin-block-start: 1em");
    expect(css).toContain("--smoothstream-h6-margin-block-end: 0.25em");
    expect(css).toMatch(
      /theme="default"\] h4\) \{[\s\S]*?margin-block-start: var\(--smoothstream-h4-margin-block-start\);[\s\S]*?font-size: 1em;/,
    );
    expect(css).toMatch(
      /theme="default"\] h5\) \{[\s\S]*?font-size: 1em;[\s\S]*?font-weight: 400;/,
    );
    expect(css).toMatch(
      /theme="default"\] h6\) \{[\s\S]*?font-size: 1em;[\s\S]*?font-weight: 400;/,
    );
    expect(css).toMatch(
      /theme="default"\] h3\) \{[\s\S]*?margin-block-start: var\(--smoothstream-h3-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-h3-margin-block-end\);[\s\S]*?font-size: 1\.125em;/,
    );
    expect(css).toMatch(
      /theme="default"\] h2\) \{[\s\S]*?margin-block-start: var\(--smoothstream-h2-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-h2-margin-block-end\);[\s\S]*?font-size: 1\.25em;/,
    );
    expect(css).toMatch(
      /theme="default"\] h1\) \{[\s\S]*?margin-block-start: var\(--smoothstream-h1-margin-block-start\);[\s\S]*?margin-block-end: var\(--smoothstream-h1-margin-block-end\);[\s\S]*?font-size: 1\.5em;/,
    );
    expect(css).not.toContain("h1 + *");
    expect(css).not.toContain("h2 + *");
    expect(css).toMatch(
      /img\[data-smoothstream-image-standalone\][\s\S]*?:where\(\[data-smoothstream-theme="default"\] > :first-child\) \{[\s\S]*?margin-block-start: 0;/,
    );
    expect(css).toMatch(
      /> :last-child\) \{[\s\S]*?margin-block-end: 0;/,
    );
    expect(css).toMatch(
      /:is\(p, ul, ol, blockquote\):has\(\+ pre\)[\s\S]*?margin-block-end: 0;/,
    );
    expect(css).toMatch(
      /pre \+ :is\(p, ul, ol, blockquote\)[\s\S]*?margin-block-start: 0;/,
    );
    expect(css).toMatch(
      /theme="default"\] pre\) \{[\s\S]*?margin-block: var\(--smoothstream-code-margin-block\);/,
    );
    expect(css).not.toContain("margin-block: 1.7em");
    expect(css).toContain("--smoothstream-font-mono:");
    expect(css).toContain("font-family: var(--smoothstream-font-mono)");
    expect(css).toContain("--smoothstream-inline-code-font-size: 0.875em");
    expect(css).toContain(
      "--smoothstream-code-font-size: var(--smoothstream-inline-code-font-size)",
    );
    expect(css).toContain(
      "font-size: var(--smoothstream-inline-code-font-size)",
    );
    expect(css).toContain("font-size: var(--smoothstream-code-font-size)");
    expect(css).toContain("--smoothstream-code-border-color");
    expect(css).toContain("--smoothstream-code-scrollbar-color");
    expect(css).toContain("--smoothstream-code-scrollbar-hover-color");
    expect(css).toContain("--smoothstream-shiki-background");
    expect(css).toContain("--smoothstream-shiki-color");
    expect(css).toContain("[data-smoothstream-code-toolbar]");
    expect(css).toContain("[data-smoothstream-code-language]");
    expect(css).toMatch(
      /\[data-smoothstream-code-toolbar\][\s\S]*?padding: 0\.55rem var\(--smoothstream-code-padding-inline\) 0;/,
    );
    expect(css).toMatch(
      /\[data-smoothstream-code-copy\][\s\S]*?margin-inline-end: calc\(\(1rem - 1\.75rem\) \/ 2\);/,
    );
    expect(css).toMatch(
      /\[data-smoothstream-code-block\] > code[\s\S]*?padding: 0\.55em var\(--smoothstream-code-padding-inline\) 0\.9em;/,
    );
    expect(css).toMatch(
      /\[data-smoothstream-code-icon-swap\]\[data-state="copy"\][\s\S]*?opacity: 0\.65;/,
    );
    expect(css).toMatch(
      /\[data-smoothstream-code-icon-swap\]\[data-state="check"\][\s\S]*?opacity: 1;/,
    );
    expect(css).toContain("[data-smoothstream-code-copy]:hover");
    expect(css).toContain("--smoothstream-task-size");
    expect(css).toContain("--smoothstream-task-offset");
    expect(css).toContain("--smoothstream-task-border-color");
    expect(css).toContain("--smoothstream-task-border-radius");
    expect(css).toContain("--smoothstream-task-checked-background");
    expect(css).toContain("--smoothstream-task-check-image");
    expect(css).toContain("stroke='white'");
    expect(css).toContain("background-blend-mode: difference");
    expect(css).toMatch(
      /theme="default"\] li\) \{[\s\S]*?padding-inline-start: 0\.375em;/,
    );
    expect(css).not.toContain("ol > li > p + p");
    expect(css).toContain('input[type="checkbox"]:checked');
    expect(css).toContain("display: block");
    expect(css).toContain("box-sizing: border-box");
    expect(css).toContain("-webkit-appearance: none");
    expect(css).toContain("appearance: none");
    expect(css).toContain(
      "background-image: var(--smoothstream-task-check-image)",
    );
    expect(css).toContain("margin-inline: -1.25rem 0.5rem");
    expect(css).toMatch(
      /@supports \(font: -apple-system-body\) and \(-webkit-appearance: none\)[\s\S]*?margin-inline: -1\.5rem 0\.5rem;/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?-webkit-appearance: auto;[\s\S]*?appearance: auto;/,
    );
    expect(css).toContain("--smoothstream-table-border-color");
    expect(css).toContain("--smoothstream-table-border-width");
    expect(css).toContain("--smoothstream-table-border-style");
    expect(css).toContain("--smoothstream-table-border-radius");
    expect(css).toContain("--smoothstream-table-margin-block: 0.5em");
    expect(css).toContain("--smoothstream-image-margin-block: 1.5em");
    expect(css).toMatch(
      /img\[data-smoothstream-image-standalone\][\s\S]*?margin-block: var\(--smoothstream-image-margin-block\);/,
    );
    expect(css).toContain("--smoothstream-table-header-background");
    expect(css).toContain("[data-smoothstream-table-shell]");
    expect(css).toMatch(
      /\[data-smoothstream-table-shell\][\s\S]*?margin-block: var\(--smoothstream-table-margin-block\);[\s\S]*?border: var\(--smoothstream-table-border-width\)[\s\S]*?var\(--smoothstream-table-border-style\)[\s\S]*?var\(--smoothstream-table-border-color\);/,
    );
    expect(css).toContain("border-collapse: separate");
    expect(css).toContain(
      ':where([data-smoothstream-theme="default"] tbody tr:not(:first-child) td)',
    );
    expect(css).toContain("max-width: 100%");
    expect(css).toContain("ui-monospace, SFMono-Regular");
    expect(css).toContain("scrollbar-width: thin");
    expect(css).toContain("::-webkit-scrollbar-thumb");
    expect(css).toMatch(
      /:where\(\[data-smoothstream-theme="default"\] th\) \{[\s\S]*?text-align: start;/,
    );
    expect(css).toContain("img[data-smoothstream-image-standalone]");
    expect(css).not.toContain("p > img:only-child");
    expect(cssWithoutComments).not.toMatch(
      /:(?:only-child|only-of-type|empty)\b/,
    );
    expect(css).not.toContain("[data-smoothstream-unit]");
    expect(css).not.toContain("[data-smoothstream-state]");
    expect(css).not.toContain("!important");
    expect(css).not.toContain("@keyframes");
  });
});
