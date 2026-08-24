export interface StreamDelivery {
  /** The delay after the previous delivery, or after playback begins. */
  readonly delayMs: number;
  readonly text: string;
}

export interface StreamCase {
  readonly deliveries: ReadonlyArray<StreamDelivery>;
  readonly id: string;
  readonly label: string;
}

export const REPLAY_TOKEN = "__SMOOTHSTREAM_REPLAY__";

const CHUNK_PATTERN = [19, 13, 27, 16, 23, 11, 31, 17] as const;
const STRESS_CHUNK_PATTERN = [7, 11, 5, 13, 9] as const;
const BENCHMARK_CHUNK_PATTERN = [7, 13, 5, 19, 11, 23, 9, 17] as const;
const BENCHMARK_DELAY_PATTERN = [
  12,
  8,
  20,
  10,
  34,
  14,
  9,
  48,
  11,
  16,
  72,
  9,
] as const;

const chunkMarkdown = (
  markdown: string,
  initialDelayMs = 250,
  deliveryIntervalMs = 24,
  chunkPattern: ReadonlyArray<number> = CHUNK_PATTERN,
): ReadonlyArray<StreamDelivery> => {
  const deliveries: StreamDelivery[] = [];
  let cursor = 0;
  let chunkIndex = 0;

  while (cursor < markdown.length) {
    const chunkSize = chunkPattern[chunkIndex % chunkPattern.length] ?? 16;
    const nextCursor = Math.min(markdown.length, cursor + chunkSize);
    deliveries.push({
      delayMs: chunkIndex === 0 ? initialDelayMs : deliveryIntervalMs,
      text: markdown.slice(cursor, nextCursor),
    });
    cursor = nextCursor;
    chunkIndex += 1;
  }

  return deliveries;
};

const chunkMarkdownWithVariableTiming = (
  markdown: string,
  initialDelayMs = 250,
  chunkPattern: ReadonlyArray<number> = BENCHMARK_CHUNK_PATTERN,
  delayPattern: ReadonlyArray<number> = BENCHMARK_DELAY_PATTERN,
): ReadonlyArray<StreamDelivery> => {
  const deliveries: StreamDelivery[] = [];
  let cursor = 0;
  let chunkIndex = 0;

  while (cursor < markdown.length) {
    const chunkSize = chunkPattern[chunkIndex % chunkPattern.length] ?? 12;
    const nextCursor = Math.min(markdown.length, cursor + chunkSize);
    deliveries.push({
      delayMs: chunkIndex === 0
        ? initialDelayMs
        : delayPattern[(chunkIndex - 1) % delayPattern.length] ?? 16,
      text: markdown.slice(cursor, nextCursor),
    });
    cursor = nextCursor;
    chunkIndex += 1;
  }

  return deliveries;
};

const showcase = `# A calmer kind of streaming

Smoothstream separates **how quickly text arrives** from how it appears. The source can race ahead while the presentation stays measured, stable, and easy to follow within [CommonMark semantics](https://commonmark.org/).

---

## Structure sets the rhythm

- Paragraphs move with the cadence of natural language.
- Headings arrive as confident, complete thoughts.
- Lists settle one item at a time instead of exposing their syntax.
  - Nested ideas retain their hierarchy.

Inline details can carry *quiet emphasis*, ~~superseded text~~, \`code\`, and a small decoded image ![completed inline marker](/image-inline.svg).

The integration stays small:

1. Append incoming text to \`source\`.
2. Keep \`receiving\` true while more text may arrive.
3. Let Smoothstream pace the finished Markdown into view.

- [x] Structural Markdown is ready.
- [ ] Presentation is still unfolding.

## A table should feel like a table

| Element | Reveal strategy | Why it works |
| --- | --- | --- |
| Prose | Flowing words | Reading begins without waiting for the response to finish |
| Lists | One item at a time | Related ideas keep their visual rhythm |
| Tables | Header, then rows | Columns stay stable while information unfolds |
| Code | Stable lines, flowing characters | Syntax never flashes as unfinished fencing |

> The network delivers characters. Smoothstream presents meaning.

## Code arrives with context

\`\`\`tsx
renderer.update(message.content, { receiving });
\`\`\`

The renderer needs the Markdown accumulated so far. Smoothstream handles the buffering, parsing, scheduling, and transition choreography internally.`;

const delimiterRegression = `# Delimiter containment

**This opening delimiter is intentionally never closed.

## This heading must remain clean

An unmatched inline marker belongs to its own paragraph. It must never cause synthetic characters to appear in a later block.

### The table still has structure

| Check | Expected result |
| --- | --- |
| Literal marker | Remains in its original paragraph |
| Later headings | Never receive trailing asterisks |
| Table rows | Reveal without changing column geometry |

** Business-style annotations with a space remain ordinary literal text.

The final paragraph should finish normally, without a global repair pass rewriting the source.`;

const lateWideCell: ReadonlyArray<StreamDelivery> = [
  { delayMs: 250, text: "| ID | Notes | Status |\n" },
  { delayMs: 35, text: "| --- | --- | --- |\n" },
  { delayMs: 35, text: "| A1 | Short | Ready |\n" },
  { delayMs: 35, text: "| B2 | Brief | Ready |\n" },
  {
    delayMs: 35,
    text: "| CUSTOMER-EXPORT-WITH-AN-EXTREMELY-LONG-IDENTIFIER | This late row would normally resize the first column | Ready |\n",
  },
  { delayMs: 35, text: "\nThe table is complete.\n" },
];

const pausedTable: ReadonlyArray<StreamDelivery> = [
  { delayMs: 250, text: "Incoming quarterly data:\n\n" },
  { delayMs: 40, text: "| Quarter | Revenue | Change |\n" },
  { delayMs: 40, text: "| --- | ---: | ---: |\n" },
  { delayMs: 40, text: "| Q1 | $120k | +8% |\n" },
  { delayMs: 40, text: "| Q2 | $138k | +15% |\n" },
  { delayMs: 2_000, text: "| Q3 | $141k | +2% |\n" },
  { delayMs: 40, text: "| Q4 | $166k | +18% |\n" },
  { delayMs: 40, text: "\nAll four quarters are now confirmed.\n" },
];

const richTable = `| Feature | Example | Notes |
| --- | --- | --- |
| Emphasis | **bold** and *italic* | Inline Markdown stays semantic |
| Code | \`npm install @smoothstream/react\` | Long values can wrap naturally |
| Link | [Documentation](https://example.com) | Cell contents remain interactive |

Rich cell content should reveal without changing the table's geometry.`;

const tableAlignments = `# Table column alignments

The same table can mix default, left, center, and right-aligned columns.

| Default | Left | Center | Right |
| --- | :--- | :---: | ---: |
| Plain separator | Start edge | Middle | $1,240.00 |
| No alignment marker | Explicit left | Centered value | 98.4% |
| Inherits the table | Stays left | Balanced | 12,500 |`;

const shortThreeColumnTable = `# Intrinsic table width: short content

A compact table should remain only as wide as its content requires.

| Status | Owner | ETA |
| --- | --- | --- |
| Ready | Ana | Today |
| Review | Kai | Friday |
| Blocked | Mo | Unknown |`;

const heavyThreeColumnTable = `# Intrinsic table width: content-heavy

The same column count can require substantially more room when cells contain larger intrinsic values.

| Export | Compatibility target | Why it matters |
| --- | --- | --- |
| createDeterministicStreamingMarkdownRenderer() | ReactServerComponentsWithoutClientHydration | A long API identifier should influence the table's minimum readable width instead of being broken into fragments. |
| createIncrementalSyntaxHighlightingPipeline() | ContentSecurityPolicyWithStrictDynamicImports | Ordinary prose can still wrap naturally after the intrinsic column widths have been established. |
| preserveStructurallyStableMarkdownPrefixes() | AssistiveTechnologyAnnouncementBoundary | Three content-heavy columns should begin scrolling sooner than three short columns. |`;

const twelveColumnTable = `# Intrinsic table width: twelve columns

Many individually modest columns should accumulate into a wider intrinsic table.

| Identifier | Status | Owner | Priority | Created | Updated | Target | Region | Runtime | Retries | Latency | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BS-1042 | Ready | Ana | High | Aug 12 | Aug 18 | Web | Toronto | React | 2 | 84 ms | Stable |
| BS-1043 | Review | Kai | Medium | Aug 14 | Aug 18 | Mobile | London | Astro | 0 | 112 ms | Pending |`;

const pausedCode: ReadonlyArray<StreamDelivery> = [
  { delayMs: 250, text: "A buffered code block:\n\n```ts\n" },
  { delayMs: 40, text: "const ready = true;\n" },
  { delayMs: 40, text: "render(" },
  { delayMs: 2_000, text: "ready);\n" },
  { delayMs: 1_200, text: "```\n\nThe fence arrived separately.\n" },
];

const codeLanguages = `# Syntax languages

## TypeScript

\`\`\`ts
type Message = { id: string; content: string };
const visible = messages.filter((message) => message.content.length > 0);
\`\`\`

## JSON

\`\`\`json
{
  "interval": 3,
  "duration": 1000,
  "motion": "system"
}
\`\`\`

## CSS

\`\`\`css
.assistant-message {
  color: var(--smoothstream-foreground);
  max-width: 72ch;
}
\`\`\`

## Shell

\`\`\`sh
npm install @smoothstream/react @smoothstream/code
npm run demo
\`\`\`

## Unknown language fallback

\`\`\`smoothstream-config
reveal = "stable"
lookahead = true
\`\`\``;

const codeTheme = `# Theme palette

The code surface and its tokens should arrive with the selected Shiki palette already applied.

\`\`\`ts
interface RevealOptions {
  interval: number;
  duration: number;
}

const defaults: RevealOptions = {
  interval: 3,
  duration: 1000,
};
\`\`\`

The surrounding prose remains part of the application's ordinary typography.`;

const codeHorizontalScroll = `# Horizontal code overflow

Long source lines retain their formatting and use a native horizontal scrollbar.

\`\`\`ts
const packageManifest = createManifest({ name: "@smoothstream/react", dependency: "@smoothstream/core", description: "Deterministic, structurally stable Markdown reveals for streamed AI responses without layout flashes or unfinished syntax." });
\`\`\``;

const delayedInlineMarkup: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "# Inline commit groups\n\nThe beginning of this sentence is ordinary prose and can start revealing while a later **deliberate inline phrase remains unresolved long enough for the marker itself to become the active boundary",
  },
  {
    delayMs: 1_400,
    text: "** before its closing delimiter arrives.\n\n",
  },
  { delayMs: 40, text: "Read [the documentation](" },
  {
    delayMs: 1_400,
    text: "https://example.com) when the complete link is ready.\n\n",
  },
  { delayMs: 40, text: "Run `npm install" },
  { delayMs: 1_400, text: "` without exposing backticks.\n\n" },
  { delayMs: 40, text: "** Business annotations remain literal.\n\n" },
  {
    delayMs: 40,
    text: "Nested **bold with *emphasis*** and ~~finished work~~ remain semantic.\n",
  },
];

const longInlineCode = `# Long inline code

A longer expression should remain inline and wrap naturally when needed: \`renderer.update(message.content, { receiving: status === "streaming", interval: 3, duration: 1000, motion: "system" })\` while the surrounding sentence continues normally after it.`;

const inlineSettlement = `# Inline settlement boundary

Ordinary text before **strong emphasis**, *quiet emphasis*, ~~deleted text~~, [a complete link](https://example.com/docs), \`inline code\`, and a small ![completed inline marker](/image-inline.svg) should keep exactly the same line geometry when its temporary reveal spans are removed.

Text before **the first semantic element child** remains ordinary text even after compaction, and this plain ending must not move.

**Strong text begins this paragraph**, followed by ordinary prose and \`code at the end\`.`;

const bufferedWordWrapping = `# Buffered word wrapping

This intentionally narrow measure puts ordinary words close to the available edge so character reveal can reserve each complete buffered word before its first letter appears.

Careful deterministic presentation should choose the final line immediately instead of beginning a word above and moving it below.`;

const delayedLinkDestination: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "Ordinary prose before the link can reveal at its normal pace while the destination remains incomplete. Read [the documentation](",
  },
  {
    delayMs: 1_600,
    text: "https://example.com/docs) once the complete, stable destination arrives.\n\nFollowing prose keeps its own reveal schedule.\n",
  },
];

const lateReferenceLink: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "The sentence can begin revealing while its final [streaming guide][docs] waits for a reference definition.\n\nThis later paragraph stays buffered so it cannot overtake the unresolved reference.\n\n",
  },
  {
    delayMs: 1_600,
    text: '[docs]: https://example.com/streaming "Streaming guide"\n\nThe definition never appears as visible content.\n',
  },
];

const autolinks = `# Complete autolinks

A protocol URL such as https://example.com/releases becomes one stable link.

GFM also recognizes www.example.com/support and help@example.com without exposing partial targets.

An explicit [relative link](/docs/getting-started) and [fragment link](#complete-autolinks) follow the same interaction rules.`;

const incrementalList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "# Incremental lists\n\n- The first item is complete as soon as the next marker begins.\n- The second item contains enough ordinary prose to start revealing while its final words remain buffered",
  },
  {
    delayMs: 1_800,
    text: " and then continue after the packet pause.\n- The third marker confirms the complete second item.\n\nThe list is now closed.\n",
  },
];

const nestedList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "# Nested list stability\n\n- The parent item is stable before its children begin.\n  - Nested item one is complete.\n  - Nested item two is still open",
  },
  {
    delayMs: 1_800,
    text: " until this delivery completes it.\n- The following top-level item confirms the nested branch.\n\nThe nested list is now closed.\n",
  },
];

const nestedListBlocks = [
  "# Nested list blocks",
  "",
  "1. Outer ordered item includes every nested block kind.",
  "",
  "   ### Outer heading",
  "",
  "   ```ts",
  "   const outerOl = \"level-1\";",
  "   ```",
  "",
  "   | Place | Kind |",
  "   | --- | --- |",
  "   | outer ol | table |",
  "",
  "   > Outer blockquote.",
  "",
  "   ---",
  "",
  "   - Nested unordered item includes the same blocks.",
  "",
  "     #### Nested heading",
  "",
  "     ```ts",
  "     const nestedUl = \"level-2\";",
  "     ```",
  "",
  "     | Place | Kind |",
  "     | --- | --- |",
  "     | nested ul | table |",
  "",
  "     > Nested blockquote.",
  "",
  "     ---",
  "",
  "     1. Innermost ordered item closes the nest.",
  "",
  "        ##### Inner heading",
  "",
  "        ```ts",
  "        const nestedOl = \"level-3\";",
  "        ```",
  "",
  "        | Place | Kind |",
  "        | --- | --- |",
  "        | nested ol | table |",
  "",
  "        > Inner blockquote.",
  "",
  "        ---",
  "",
].join("\n");

const markerMotion = `# Native marker motion

1. Ordered markers keep their generated number.
2. Consumer marker colors, typefaces, and glyph choices remain available.
3. The text indentation should not move while a marker settles.

- Bullets fade into place without replacing \`::marker\`.
- A second item makes the repeated motion easier to compare.
  - Nested bullets use the same entrance.`;

const pausedTaskList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "# Incremental task lists\n\n- [x] The completed item can reveal immediately.\n- [ ] This open task contains enough ordinary label text to begin revealing while its final words remain buffered",
  },
  {
    delayMs: 1_800,
    text: " across the packet pause.\n- [x] A later checked item waits for its own turn.\n  - [ ] The first nested task is complete.\n  - [ ] The second nested task remains open long enough to establish a visible prefix",
  },
  {
    delayMs: 1_800,
    text: " before the final delivery closes it.\n\nAll task items are now confirmed.\n",
  },
];

const visibleThenLooseList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "- The first item starts in a tight list.\n",
  },
  { delayMs: 40, text: "- The second item keeps the same compact spacing.\n" },
  { delayMs: 40, text: "- The third item remains a single paragraph.\n" },
  { delayMs: 40, text: "- The fourth item remains a single paragraph.\n" },
  { delayMs: 40, text: "- The fifth item remains a single paragraph.\n" },
  { delayMs: 40, text: "- The sixth item remains a single paragraph.\n" },
  { delayMs: 40, text: "- The seventh item remains a single paragraph.\n" },
  {
    delayMs: 40,
    text: "- The final item initially looks like every other tight-list item",
  },
  {
    delayMs: 40,
    text: ".\n\n  A second paragraph arrives inside only the final item, making CommonMark reclassify the entire list as loose.\n",
  },
];

const looseBeforeRevealList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "Incoming Markdown is deliberately faster than presentation. This paragraph gives the source enough lead to determine the complete list structure before the first list item reaches the screen.\n\n- The first item is still waiting behind the paragraph.\n",
  },
  {
    delayMs: 30,
    text: "- The second item arrives while the list is hidden.\n",
  },
  { delayMs: 30, text: "- The third item also keeps the source list tight.\n" },
  { delayMs: 30, text: "- The fourth item remains a single paragraph.\n" },
  { delayMs: 30, text: "- The fifth item remains a single paragraph.\n" },
  {
    delayMs: 30,
    text: "- The final item initially remains a single paragraph",
  },
  {
    delayMs: 30,
    text: ".\n\n  Its second paragraph makes the list loose before any list item is presented.\n",
  },
];

const longLateLooseList: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "- Item 01 begins the long list with one paragraph.\n",
  },
  ...Array.from({ length: 28 }, (_, index): StreamDelivery => {
    const itemNumber = String(index + 2).padStart(2, "0");
    return {
      delayMs: 30,
      text: `- Item ${itemNumber} keeps the incoming Markdown list tight.\n`,
    };
  }),
  {
    delayMs: 30,
    text: "- Item 30 initially looks like every preceding tight-list item",
  },
  {
    delayMs: 30,
    text: ".\n\n  This second paragraph in the final item changes the entire thirty-item list to loose.\n",
  },
];

const realWorldLooseList = `## Weekly launch update

- **Authentication migration**

  The new sign-in flow is enabled for employees and ten percent of customers. Error rates remain below the rollout threshold.

  Support will monitor recovery requests before the rollout expands on Monday.

- **Billing validation**

  Finance completed the production invoice review, and the remaining tax calculation issue is limited to one region.

- **Customer documentation**

  The migration guide now includes screenshots, rollback instructions, and a checklist that account teams can share before launch.
`;

const standaloneImage = `A standalone image should enter as one decoded unit:

![A geometric landscape test image](/image-landscape.svg)

Text after the image keeps its own reveal schedule.`;

const delayedImage: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: `![A deliberately delayed geometric image](/image-landscape.svg?delay=1200&case=block-slot&replay=${REPLAY_TOKEN})\n\nLater text continues revealing while the image request is unresolved.\n`,
  },
];

const cssReservedImage: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: `![A delayed image with CSS-reserved geometry](/image-landscape.svg?delay=1200&layout=known&replay=${REPLAY_TOKEN})\n\nThe paragraph below should begin in its final position while the image is still downloading.\n`,
  },
];

const brokenImage: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "![The native fallback for a missing image](/image-that-does-not-exist.svg)\n\nA failed image must not block this later paragraph.\n",
  },
];

const inlineImage = `Ordinary prose appears before a small inline image ![completed inline marker](/image-inline.svg) and continues after it without exposing image syntax.`;

const repeatedImage = `The first copy uses the local image resource:

![First copy of the geometric landscape](/image-landscape.svg)

The same URL appears again later:

![Second copy of the geometric landscape](/image-landscape.svg)

Both images retain independent reveal positions while sharing the browser cache.`;

const compoundBlockquote: ReadonlyArray<StreamDelivery> = [
  {
    delayMs: 250,
    text: "# Compound blockquotes\n\n> This quoted paragraph contains enough ordinary prose to begin revealing while its trailing words remain buffered",
  },
  {
    delayMs: 1_800,
    text: " across a packet pause.\n>\n> - The first quoted list item is complete.\n> - The second quoted item remains open long enough to establish a stable prefix",
  },
  {
    delayMs: 1_800,
    text: " before it closes.\n>\n> > A nested quote enters only when its own prose is ready.\n>\n> ```ts\n> const quoted = true;\n> ```\n\n***\n\nThe quote and thematic break are complete.\n",
  },
];

const benchmarkSections = Array.from({ length: 4 }, (_, index) => {
  const section = index + 1;
  return `## Matched section ${section}

This paragraph is ordinary prose at a length that spans several reveal frames. Character pacing should stay even, while **inline emphasis remains semantic** and [a local link](#matched-section-${section}) exercises an ordinary inline boundary.

- The first list item is intentionally concise.
- The second item adds enough text to cross several visual frames.
- The final item closes before the following heading begins.
`;
}).join("\n");

const benchmarkMarkdown = `# Long-form streaming Markdown

This document is large enough to exercise pacing, inline emphasis, lists, and
local links under both a single complete snapshot and many small live deltas.

${benchmarkSections}

The last paragraph keeps the reveal active long enough to drain a substantial
schedule on slower machines.
`;

const benchmarkDeliveries: ReadonlyArray<StreamDelivery> = [
  { delayMs: 250, text: benchmarkMarkdown },
];

const liveBenchmarkDeliveries = chunkMarkdownWithVariableTiming(
  benchmarkMarkdown,
);

const stressSections = Array.from({ length: 6 }, (_, index) => {
  const section = String(index + 1).padStart(2, "0");
  return `## Processing batch ${section}

This paragraph deliberately contains enough ordinary prose to keep the reveal cursor occupied while several newer packets arrive. **Committed emphasis remains semantic**, and [the local reference dawg](#processing-batch-${section}) exercises an inline destination without interrupting the surrounding cadence.

- Batch ${section} keeps its first list item concise.
- A second item includes a little more language so temporary character spans accumulate and then compact after the block settles.
- The final item closes the list before the next heading arrives.
`;
}).join("\n");

const stressMarkdown = `# Fast input, paced presentation

This scenario sends many small packets almost immediately. Presentation should remain smooth while the accumulated source races far ahead of the visible reveal.

${stressSections}

## Buffered table

| Batch | Packets | Expected state |
| --- | ---: | --- |
| Alpha | 84 | Parsed ahead of presentation |
| Beta | 112 | Waiting in the reveal schedule |
| Gamma | 136 | Stable column geometry |
| Delta | 168 | Revealed only in document order |

## Buffered code

\`\`\`ts
const packets = incoming.flatMap(coalesce);
const latestSnapshot = packets.at(-1);
renderMarkdown(latestSnapshot);
\`\`\`

The final paragraph confirms that all incoming Markdown has been received even though the presentation may still be draining its intentional reveal backlog.
`;

const stressDeliveries = chunkMarkdown(
  stressMarkdown,
  150,
  1,
  STRESS_CHUNK_PATTERN,
);

export const streamCases: ReadonlyArray<StreamCase> = [
  {
    id: "showcase",
    label: "Showcase",
    deliveries: chunkMarkdown(showcase),
  },
  {
    id: "stress-fast-long-response",
    label: "Stress: fast long response",
    deliveries: stressDeliveries,
  },
  {
    id: "benchmark-complete-snapshot",
    label: "Benchmark: complete snapshot",
    deliveries: benchmarkDeliveries,
  },
  {
    id: "benchmark-live-deltas",
    label: "Benchmark: live deltas",
    deliveries: liveBenchmarkDeliveries,
  },
  {
    id: "delimiter-regression",
    label: "Unmatched **",
    deliveries: chunkMarkdown(delimiterRegression),
  },
  {
    id: "table-late-wide-cell",
    label: "Table: late wide cell",
    deliveries: lateWideCell,
  },
  {
    id: "table-mid-stream-pause",
    label: "Table: mid-stream pause",
    deliveries: pausedTable,
  },
  {
    id: "table-rich-cells",
    label: "Table: rich cells",
    deliveries: chunkMarkdown(richTable),
  },
  {
    id: "table-alignments",
    label: "Table: alignments",
    deliveries: chunkMarkdown(tableAlignments),
  },
  {
    id: "table-intrinsic-short",
    label: "Table: intrinsic short",
    deliveries: chunkMarkdown(shortThreeColumnTable),
  },
  {
    id: "table-intrinsic-heavy",
    label: "Table: intrinsic heavy",
    deliveries: chunkMarkdown(heavyThreeColumnTable),
  },
  {
    id: "table-intrinsic-twelve",
    label: "Table: intrinsic 12 columns",
    deliveries: chunkMarkdown(twelveColumnTable),
  },
  {
    id: "code-packet-pauses",
    label: "Code: packet pauses",
    deliveries: pausedCode,
  },
  {
    id: "code-languages",
    label: "Code: languages",
    deliveries: chunkMarkdown(codeLanguages),
  },
  {
    id: "code-theme-light",
    label: "Code: theme light",
    deliveries: chunkMarkdown(codeTheme),
  },
  {
    id: "code-theme-dark",
    label: "Code: theme dark",
    deliveries: chunkMarkdown(codeTheme),
  },
  {
    id: "code-theme-dual",
    label: "Code: dual theme",
    deliveries: chunkMarkdown(codeTheme),
  },
  {
    id: "code-horizontal-scroll",
    label: "Code: horizontal scroll",
    deliveries: chunkMarkdown(codeHorizontalScroll),
  },
  {
    id: "inline-delayed-markup",
    label: "Inline: delayed markup",
    deliveries: delayedInlineMarkup,
  },
  {
    id: "inline-long-code",
    label: "Inline: long code",
    deliveries: chunkMarkdown(longInlineCode),
  },
  {
    id: "inline-settlement",
    label: "Inline: settlement boundary",
    deliveries: chunkMarkdown(inlineSettlement),
  },
  {
    id: "buffered-word-wrapping",
    label: "Wrap: buffered words",
    deliveries: chunkMarkdown(bufferedWordWrapping),
  },
  {
    id: "link-delayed-destination",
    label: "Link: delayed destination",
    deliveries: delayedLinkDestination,
  },
  {
    id: "link-late-reference",
    label: "Link: late reference",
    deliveries: lateReferenceLink,
  },
  {
    id: "link-autolinks",
    label: "Link: autolinks",
    deliveries: chunkMarkdown(autolinks),
  },
  {
    id: "list-incremental",
    label: "List: incremental",
    deliveries: incrementalList,
  },
  {
    id: "list-nested",
    label: "List: nested",
    deliveries: nestedList,
  },
  {
    id: "list-nested-blocks",
    label: "List: nested blocks",
    deliveries: chunkMarkdown(nestedListBlocks),
  },
  {
    id: "list-marker-motion",
    label: "List: marker motion",
    deliveries: chunkMarkdown(markerMotion),
  },
  {
    id: "list-task-items",
    label: "List: task items",
    deliveries: pausedTaskList,
  },
  {
    id: "list-loose-before-reveal",
    label: "List: loose before reveal",
    deliveries: looseBeforeRevealList,
  },
  {
    id: "list-visible-then-loose",
    label: "List: visible then loose",
    deliveries: visibleThenLooseList,
  },
  {
    id: "list-long-late-loose",
    label: "List: long, final item loose",
    deliveries: longLateLooseList,
  },
  {
    id: "list-real-world-loose",
    label: "List: real-world loose",
    deliveries: chunkMarkdown(realWorldLooseList),
  },
  {
    id: "image-standalone",
    label: "Image: standalone",
    deliveries: chunkMarkdown(standaloneImage),
  },
  {
    id: "image-delayed-load",
    label: "Image: delayed load",
    deliveries: delayedImage,
  },
  {
    id: "image-css-reserved-geometry",
    label: "Image: CSS-reserved geometry",
    deliveries: cssReservedImage,
  },
  {
    id: "image-broken-source",
    label: "Image: broken source",
    deliveries: brokenImage,
  },
  {
    id: "image-inline",
    label: "Image: inline",
    deliveries: chunkMarkdown(inlineImage),
  },
  {
    id: "image-repeated-cached-url",
    label: "Image: repeated cached URL",
    deliveries: chunkMarkdown(repeatedImage),
  },
  {
    id: "blockquote-compound",
    label: "Blockquote: compound",
    deliveries: compoundBlockquote,
  },
];
