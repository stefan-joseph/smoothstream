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
    expect(css).toContain('[data-smoothstream-motion="animate"]');
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
      /pre\[data-smoothstream-code-block\] > code \{[\s\S]*?overflow-x: auto;[\s\S]*?ui-monospace[\s\S]*?font-size: 0\.875em;/,
    );
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
    expect(css).not.toContain(":where([data-smoothstream])");
    expect(css).toContain("--smoothstream-foreground: currentColor");
    expect(css).toContain(
      "--smoothstream-body-color: var(--smoothstream-foreground)",
    );
    expect(css).not.toContain("--smoothstream-foreground: #171717");
    expect(css).toContain("color-mix(");
    expect(css).toContain("--smoothstream-link-color");
    expect(css).toContain("--smoothstream-inline-code-color");
    expect(css).toContain("--smoothstream-code-background");
    expect(css).toContain("--smoothstream-code-border-color");
    expect(css).toContain("--smoothstream-code-scrollbar-color");
    expect(css).toContain("--smoothstream-code-scrollbar-hover-color");
    expect(css).toContain("--smoothstream-shiki-background");
    expect(css).toContain("--smoothstream-shiki-color");
    expect(css).toContain("[data-smoothstream-code-toolbar]");
    expect(css).toContain("[data-smoothstream-code-language]");
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
      /theme="default"\] li\) \{[\s\S]*?margin-block: 0\.75em;/,
    );
    expect(css).toMatch(
      /li > p\) \{[\s\S]*?margin-block: 0;/,
    );
    expect(css).toMatch(
      /li > p \+ p\) \{[\s\S]*?margin-block-start: 0\.5em;/,
    );
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
    expect(css).toContain("--smoothstream-table-header-background");
    expect(css).toContain("[data-smoothstream-table-shell]");
    expect(css).toMatch(
      /\[data-smoothstream-table-shell\][\s\S]*?border: var\(--smoothstream-table-border-width\)[\s\S]*?var\(--smoothstream-table-border-style\)[\s\S]*?var\(--smoothstream-table-border-color\);/,
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
