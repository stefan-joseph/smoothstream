import { describe, expect, it } from "vitest";
import { createCodeHighlighter } from "../../packages/code/src/index";

const sourceOf = (lines: ReadonlyArray<{ tokens: ReadonlyArray<{ content: string }> }>):
  string => lines.map((line) => line.tokens.map((token) => token.content).join("")).join("\n");

describe("Shiki code highlighter", () => {
  it("lazily tokenizes only complete appended lines in one fenced-block session", async () => {
    const highlighter = createCodeHighlighter();
    const session = {};

    const first = await highlighter.highlight({
      code: "const ready = true;\n",
      language: "ts",
      session,
    });
    const second = await highlighter.highlight({
      code: "const ready = true;\nconsole.log(ready);\n",
      language: "ts",
      session,
    });

    expect(sourceOf(first.lines)).toBe("const ready = true;");
    expect(sourceOf(second.lines)).toBe(
      "const ready = true;\nconsole.log(ready);",
    );
    expect(first.lines[0]?.tokens.some((token) => token.style?.color)).toBe(true);
    expect(first.languageLabel).toBe("TypeScript");
    expect(second.lines).toHaveLength(2);
    expect(second.palette).toEqual(first.palette);
  });

  it("loads explicitly fenced languages discovered inside another language", async () => {
    const highlighter = createCodeHighlighter();
    const session = {};

    await highlighter.highlight({
      code: "# An MDX guide\n\n",
      language: "mdx",
      session,
    });
    const result = await highlighter.highlight({
      code: [
        "# An MDX guide",
        "",
        "Use a fenced example inside the guide:",
        "",
        "```python",
        "def greet(name: str) -> str:",
        "    return f\"Hello, {name}!\"",
        "```",
        "",
      ].join("\n"),
      language: "mdx",
      session,
    });

    const embeddedLine = result.lines[5];
    expect(embeddedLine?.tokens.map((token) => token.content).join(""))
      .toBe("def greet(name: str) -> str:");
    expect(new Set(embeddedLine?.tokens.map((token) => token.style?.color)).size)
      .toBeGreaterThan(1);
  });

  it("loads intrinsic companion grammars on a fresh highlighter", async () => {
    const mdx = await createCodeHighlighter().highlight({
      code: [
        '<Accordion title="What is MDX?">',
        "  {answer}",
        "</Accordion>",
        "",
      ].join("\n"),
      language: "mdx",
      session: {},
    });
    const haml = await createCodeHighlighter().highlight({
      code: "%p= user.name\n",
      language: "haml",
      session: {},
    });

    expect(mdx.lines[0]?.tokens.find((token) =>
      token.content === "Accordion"
    )?.style?.color).toBeTruthy();
    expect(haml.lines[0]?.tokens.find((token) =>
      token.content === "name"
    )?.style?.color).toBeTruthy();
  });

  it("recognizes Shiki aliases and leaves unknown languages unhighlighted", async () => {
    const highlighter = createCodeHighlighter();

    expect(highlighter.supportsLanguage?.("ts")).toBe(true);
    expect(highlighter.supportsLanguage?.("typescript")).toBe(true);
    expect(highlighter.supportsLanguage?.("smoothstream-config")).toBe(false);

    const fallback = await highlighter.highlight({
      code: "reveal = \"stable\"\n",
      language: "smoothstream-config",
      session: {},
    });
    expect(fallback.lines).toEqual([{
      tokens: [{ content: "reveal = \"stable\"" }],
    }]);
    expect(fallback.languageLabel).toBe("smoothstream-config");
    expect(fallback.palette?.backgroundColor).toBeTruthy();
    expect(fallback.palette?.color).toBeTruthy();
  });

  it("returns the complete palette for a bundled Shiki theme name", async () => {
    const light = await createCodeHighlighter({
      theme: "vitesse-light",
    }).highlight({
      code: "const themed = true;\n",
      language: "ts",
      session: {},
    });
    const dark = await createCodeHighlighter({ theme: "github-dark" }).highlight({
      code: "const themed = true;\n",
      language: "ts",
      session: {},
    });

    expect(light.lines[0]?.tokens.some((token) => token.style?.color)).toBe(true);
    expect(light.palette?.backgroundColor).toBeTruthy();
    expect(light.palette?.color).toBeTruthy();
    expect(dark.palette?.backgroundColor).toBeTruthy();
    expect(dark.palette?.color).toBeTruthy();
    expect(dark.palette).not.toEqual(light.palette);
  });

  it("emits Shiki's light and dark styles from one streaming tokenizer", async () => {
    const result = await createCodeHighlighter({
      defaultColor: "light-dark()",
      themes: {
        dark: "vitesse-dark",
        light: "vitesse-light",
      },
    }).highlight({
      code: "const themed = true;\n",
      language: "ts",
      session: {},
    });

    const themedToken = result.lines[0]?.tokens.find((token) =>
      token.style?.["--shiki-dark"]
    );
    expect(themedToken?.style?.color).toMatch(/^light-dark\(/u);
    expect(themedToken?.style?.["--shiki-light"]).toBeTruthy();
    expect(themedToken?.style?.["--shiki-dark"]).toBeTruthy();
    expect(result.palette?.backgroundColor).toMatch(/^light-dark\(/u);
    expect(result.palette?.color).toMatch(/^light-dark\(/u);
    expect(result.palette?.style?.["--shiki-light-bg"]).toBeTruthy();
    expect(result.palette?.style?.["--shiki-dark-bg"]).toBeTruthy();
  });

  it("supports Shiki's no-default-color strategy", async () => {
    const result = await createCodeHighlighter({
      defaultColor: false,
      themes: {
        dark: "vitesse-dark",
        light: "vitesse-light",
      },
    }).highlight({
      code: "const themed = true;\n",
      language: "ts",
      session: {},
    });

    expect(result.palette?.backgroundColor).toBeUndefined();
    expect(result.palette?.color).toBeUndefined();
    expect(result.palette?.style?.["--shiki-light-bg"]).toBeTruthy();
    expect(result.palette?.style?.["--shiki-dark-bg"]).toBeTruthy();
    expect(result.lines[0]?.tokens.some((token) =>
      token.style?.["--shiki-light"] && token.style?.["--shiki-dark"]
    )).toBe(true);
  });

  it("rejects theme and themes together for JavaScript callers", () => {
    expect(() => createCodeHighlighter({
      theme: "vitesse-light",
      themes: {
        dark: "vitesse-dark",
        light: "vitesse-light",
      },
    } as never)).toThrow(
      '@smoothstream/code: "theme" and "themes" are mutually exclusive.',
    );
  });

  it("makes theme and themes mutually exclusive in TypeScript", () => {
    if (false) {
      const conflictingOptions = {
        theme: "vitesse-light",
        themes: {
          dark: "vitesse-dark",
          light: "vitesse-light",
        },
      } as const;
      // @ts-expect-error A highlighter cannot select single and multiple themes.
      createCodeHighlighter(conflictingOptions);
    }
    expect(true).toBe(true);
  });
});
