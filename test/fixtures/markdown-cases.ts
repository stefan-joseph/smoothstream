export interface MarkdownCase {
  readonly markdown: string;
  readonly name: string;
}

const fence = "`".repeat(3);

export const markdownCases: ReadonlyArray<MarkdownCase> = [
  {
    name: "emphasis followed by a heading",
    markdown:
      "Intro with **bold and *nested emphasis***.\n\n# Clean heading\n\n",
  },
  {
    name: "links, inline code, and escaped delimiters",
    markdown:
      "Use [the docs](https://example.com) with `inline code`, ~~completed work~~, and \\*literal asterisks\\*.\n\n",
  },
  {
    name: "a link resolved by a late reference definition",
    markdown: [
      "Read [the streaming guide][docs] when its definition arrives.",
      "",
      "A later paragraph must not overtake the unresolved reference.",
      "",
      "[docs]: https://example.com/streaming \"Streaming guide\"",
      "",
    ].join("\n"),
  },
  {
    name: "a collapsed link resolved by a late reference definition",
    markdown: [
      "Read the [streaming guide][] after its definition settles.",
      "",
      "[streaming guide]: https://example.com/collapsed",
      "",
    ].join("\n"),
  },
  {
    name: "a shortcut link resolved by a late reference definition",
    markdown: [
      "Read the [streaming guide] after its definition settles.",
      "",
      "A later paragraph must remain in document order.",
      "",
      "[streaming guide]: https://example.com/shortcut",
      "",
    ].join("\n"),
  },
  {
    name: "a list link resolved by a late reference definition",
    markdown: [
      "- Read [the guide][docs] after its definition settles.",
      "- A following item must not overtake that reference.",
      "",
      "[docs]: https://example.com/list-guide",
      "",
    ].join("\n"),
  },
  {
    name: "GFM protocol, www, and email autolinks",
    markdown:
      "Visit https://example.com/releases, www.example.com/support, or email help@example.com.\n\n",
  },
  {
    name: "a setext heading with a long provisional first line",
    markdown:
      "This heading deliberately exceeds the prose lookahead window before it is classified\n---\n\nFollowing paragraph.\n\n",
  },
  {
    name: "unordered and nested lists",
    markdown: [
      "- First **item**",
      "- Second item",
      "  - Nested item",
      "",
      "After the list.",
      "",
    ].join("\n"),
  },
  {
    name: "checked and nested task-list items",
    markdown: [
      "- [ ] Pending task",
      "- [x] Completed task",
      "  - [ ] Nested task",
      "",
      "After the task list.",
      "",
    ].join("\n"),
  },
  {
    name: "a GFM table",
    markdown: [
      "| Product | Revenue |",
      "| --- | ---: |",
      "| Almond | $12k |",
      "| Cream | $9k |",
      "",
      "After the table.",
      "",
    ].join("\n"),
  },
  {
    name: "a GFM table with every column alignment",
    markdown: [
      "| Default | Left | Center | Right |",
      "| --- | :--- | :---: | ---: |",
      "| Plain separator | Start edge | Middle | $1,240.00 |",
      "| No alignment marker | Explicit left | Centered value | 98.4% |",
      "| Inherits the table | Stays left | Balanced | 12,500 |",
      "",
    ].join("\n"),
  },
  {
    name: "nested lists with code, a table, and a quote",
    markdown: [
      "1. Outer ordered item.",
      "",
      `   ${fence}ts`,
      "   const outerOl = \"level-1\";",
      `   ${fence}`,
      "",
      "   - Nested unordered item.",
      "",
      "     | Col | Value |",
      "     | --- | --- |",
      "     | nested | table |",
      "",
      "     > Quoted nested prose.",
      "",
      "     1. Nested ordered item.",
      "",
      `        ${fence}ts`,
      "        const nestedOl = \"level-3\";",
      `        ${fence}`,
      "",
    ].join("\n"),
  },
  {
    name: "a fenced code block",
    markdown: [
      `${fence}ts`,
      "const almond = true;",
      "ship(almond);",
      fence,
      "",
      "After the code.",
      "",
    ].join("\n"),
  },
  {
    name: "standalone and inline images",
    markdown: [
      "Before the image.",
      "",
      "![A diagram](/diagram.svg \"Diagram title\")",
      "",
      "An inline ![status icon](/status.svg) image follows.",
      "",
    ].join("\n"),
  },
  {
    name: "a blockquote followed by prose",
    markdown: [
      "> Streaming should preserve **meaning**.",
      "> It should not expose syntax churn.",
      "",
      "Ordinary prose follows.",
      "",
    ].join("\n"),
  },
  {
    name: "a compound blockquote with list and code children",
    markdown: [
      "> Quoted prose introduces structured content.",
      ">",
      "> - First quoted item",
      "> - Second **quoted item**",
      ">",
      `> ${fence}ts`,
      "> const quoted = true;",
      `> ${fence}`,
      "",
      "Ordinary prose follows the compound quote.",
      "",
    ].join("\n"),
  },
  {
    name: "a thematic break between paragraphs",
    markdown: "Before the break.\n\n***\n\nAfter the break.\n\n",
  },
  {
    name: "an unmatched delimiter contained before a heading",
    markdown: "**This remains literal\n\n# This heading stays clean\n\n",
  },
];
