# Smoothstream

Deterministic, paced Markdown reveal for React and the browser DOM, built on a
framework-neutral scheduling and Markdown-analysis core.

Smoothstream is in early development. The current milestone includes:

- immutable, monotonic reveal schedules;
- Markdown parsing through unified and remark;
- source-backed reveal-unit identities;
- block-aware look-ahead for append-only streams;
- opinionated semantic reveal for prose, headings, lists, tables, code, and images;
- React and vanilla DOM renderers.

## Architecture

```text
packages/core   framework-independent Markdown analysis, scheduling, and clocks
packages/react  React rendering and browser playback
packages/dom    vanilla DOM rendering and browser playback
packages/styles shared functional CSS and default prose theme
packages/code   optional Shiki syntax-highlighting adapter
```

`@smoothstream/core` may not import React or browser DOM APIs. React users install
`@smoothstream/react`, while vanilla users install `@smoothstream/dom`; each
adapter installs core and the shared styles automatically. The workspace keeps
optional integrations out of the renderer packages.

## React usage

Import the component and pass the complete Markdown accumulated so far as
children. Smoothstream loads its animation mechanics, layout behavior, and
default prose theme automatically:

```tsx
import { Smoothstream } from "@smoothstream/react";

export function AssistantMessage({ text, receiving }: Props) {
  return (
    <Smoothstream
      receiving={receiving}
      interval={3}
      duration={1000}
      reveal="character"
    >
      {text}
    </Smoothstream>
  );
}
```

## Vanilla DOM usage

The DOM adapter creates one managed root inside a container and exposes an
imperative append-only lifecycle:

```ts
import { createSmoothstream } from "@smoothstream/dom";

const stream = createSmoothstream(document.querySelector("#response")!, {
  receiving: true,
});

stream.update(markdownReceivedSoFar, { receiving });

// When the containing view is removed:
stream.destroy();
```

It uses the same core parser, structural stabilization, schedule, timing
options, reduced-motion policies, semantic HTML, automatic styles, and optional
syntax highlighting as the React adapter.

Markdown is append-only for the lifetime of the instance. Transport packet
boundaries do not create animation timelines. Smoothstream maintains a small prose
lead and withholds structural blocks until their shape is confirmed, then adds
semantic units to one existing schedule. If several Markdown updates arrive in
one browser frame, Smoothstream parses and plans only the latest accumulated snapshot;
no content is discarded and presentation timing remains independent of packet
timing. Tables reveal one row at a time, then
fill that row by grapheme while future rows remain collapsed but continue to
inform final column widths. Fenced code admits only complete lines while input
remains open, then reveals each admitted line by grapheme; an unfinished final
line flushes when input closes. Ordinary text—including paragraphs, headings,
and list items—defaults to a Unicode-grapheme reveal, so emoji and combined
characters are never split apart. Smoothstream waits for a complete buffered word
before starting it and uses an invisible generated suffix to let the browser
choose that word's final line before its first character appears. Set
`reveal="word"` to reveal each complete word as one presentation unit instead.
Animated spans keep stable DOM identities until their containing block settles,
then the block compacts back to semantic HTML in one render. If a semantic
reclassification necessarily reparents an active span, its replacement resumes
the same scheduler-defined animation phase instead of replaying its entrance.

Complete Markdown images begin preloading as soon as their parsed URL is
available, independently of the presentation cursor. At its scheduled position,
an unresolved image mounts as the real but visually and accessibly hidden
`<img>`, allowing native consumer CSS, explicit dimensions, or `aspect-ratio`
to reserve any geometry already known by the browser. The React renderer locks
that first computed standalone-block height until it owns the transition, so
intrinsic metadata cannot cause an uncontrolled layout frame before decode.
Images decoded before their turn enter at full height. If a late standalone
image changes an unreserved block, Smoothstream animates that existing block's height
while clipping the full-proportioned image, so the image pixels never stretch.
A pending inline image withholds its suffix rather than reflowing
already-revealed prose. Later blocks remain independently scheduled if a
resource is slow or broken; a failed request reveals the native image fallback
rather than stalling the response. Once settled, temporary sizing and animation
attributes compact back to ordinary semantic `<img>` markup.

Open lists commit completed sibling items without waiting for the entire list
to close. The final item shares the prose safety lead, and nested lists apply
the same rule recursively, so a stable parent and completed nested children can
reveal while the unfinished nested tail remains withheld. A list item's native
marker fades into place with its first character; Smoothstream animates
`::marker` directly, preserving the browser-generated bullet or number and
consumer marker styles rather than substituting a custom pseudo-element. GFM
task checkboxes remain native disabled inputs and fade in with their item's
first label character; future checkboxes stay out of the DOM until that item
reaches the schedule.

Open blockquotes recursively apply the same commit rules to their semantic
children. Stable quoted prose, completed list items, and complete fenced-code
lines can reveal while the final quoted child remains open; the native
`blockquote` container stays absent until its first child begins. Thematic
breaks remain withheld until their line is complete.

Confirmed emphasis, strikethrough, links, and inline code enter the schedule as
semantic inline groups before their characters. Unfinished delimiters remain
withheld, while marker runs that cannot open Markdown—such as `** Business
note`—continue as literal prose. A link stays absent until its first label
character appears and remains non-interactive until every label entrance has
settled, at which point its complete `href` becomes active on the same anchor
node. Incomplete destinations never reach the DOM. Full, collapsed, and
shortcut reference links remain provisional when their definition may still
arrive later, so they cannot first appear as literal syntax and then change
semantics.

`receiving` is not an animation mode. It is the end-of-input signal that lets
Smoothstream distinguish a Markdown snapshot that may still change shape from a
complete response. A complete response needs only that snapshot and animates
through the same scheduler.

The `reducedMotion` option controls how Smoothstream handles
`prefers-reduced-motion`. Its default, `"system"`, respects the system
preference; `"always"` always uses Smoothstream's reduced-motion behavior,
while `"never"` ignores the preference and permits animation. With motion
reduced, Markdown stabilization remains active, but every
currently safe unit renders immediately as semantic HTML without character
pacing, temporary reveal spans, fades, transforms, or layout transitions. An
unresolved image remains a real, accessibly hidden `<img>` while it loads and
does not delay later safe content. Once a mounted response enters reduced mode,
it stays reduced so already-visible text can never replay if the policy or
system preference changes. Remounting applies the newly selected policy to the
next response.

The published React entry is marked as a Client Component, while remaining
safe for frameworks such as Next.js to prerender and hydrate. In streaming mode
with `reducedMotion="system"`, the server and first hydration render share an empty
motion-pending shell; the browser then resolves `prefers-reduced-motion` before
any Markdown becomes visible. A stream mounted with empty children therefore
resolves its reduced-motion policy while it is waiting for the first model
token. Later client-only mounts resolve synchronously. Forced `"always"` and
`"never"` reduced-motion policies are already deterministic during server
rendering and do not need the pending state.

`mode` controls content presentation separately from reduced-motion policy. It defaults
to `"streaming"`. Use `mode="static"` for previously stored messages or other
completed Markdown that should render immediately through the same semantic
pipeline. Static mode produces server-renderable settled HTML without reveal
spans or a streaming completion announcement, while `reducedMotion="system"` continues
to govern interactive feedback such as the code copy control. Once a streaming
instance's `receiving` prop becomes `false`, treat that instance as complete and
start a new one for a different response.

Block and component reveal strategies remain intentionally internal, while
Smoothstream provides opinionated but configurable text timing. `reveal` selects
`"character"` or `"word"`; `interval` controls the base character cadence.
Word mode groups each word's characters without compressing that overall
timeline. Tables fade each native row in and begin filling it with text after
two interval ticks, so their real borders remain stable throughout the reveal.
`duration` controls text entrances, the table-row fade, and image entrances.
Code uses complete lines as commit boundaries while sharing the selected text
reveal timing.

## Syntax highlighting

Syntax highlighting is an optional package, so the base renderer does not make
every Smoothstream user ship Shiki:

```sh
npm install @smoothstream/react @smoothstream/code
# or
npm install @smoothstream/dom @smoothstream/code
```

```tsx
import { Smoothstream } from "@smoothstream/react";
import { codeHighlighter } from "@smoothstream/code";

<Smoothstream
  receiving={receiving}
  codeHighlighter={codeHighlighter}
>
  {text}
</Smoothstream>
```

```ts
import { createSmoothstream } from "@smoothstream/dom";
import { codeHighlighter } from "@smoothstream/code";

const stream = createSmoothstream(container, {
  receiving: true,
  codeHighlighter,
});
```

The ready-made highlighter uses Shiki's `github-light` theme. Pass the name of
any bundled Shiki theme to choose another one:

```tsx
import { createCodeHighlighter } from "@smoothstream/code";

const codeHighlighter = createCodeHighlighter({ theme: "vitesse-light" });
```

Use Shiki's `themes` API when the surrounding application supports light and
dark color schemes:

```tsx
const codeHighlighter = createCodeHighlighter({
  themes: {
    light: "vitesse-light",
    dark: "vitesse-dark",
  },
  defaultColor: "light-dark()",
});
```

`theme` and `themes` are mutually exclusive. `defaultColor` follows Shiki's
multiple-theme behavior: it accepts `"light"` (the default), `"dark"`,
`"light-dark()"`, or `false`. The `light-dark()` strategy follows the nearest
CSS `color-scheme`, so class-based theme toggles should update that property:

```css
html {
  color-scheme: light;
}

html.dark {
  color-scheme: dark;
}
```

The generated token styles also retain Shiki's `--shiki-light` and
`--shiki-dark` variables for applications that prefer selector-based theme
switching.

The theme and language registries are bundled as lazy imports: the application
build can serve every bundled Shiki theme and grammar, but the browser fetches
only the selected theme and grammars Smoothstream encounters in fenced code. Smoothstream
passes only committed code lines to the adapter. Each fence retains its own
incremental grammar state, and a line's token colors become immutable before
its first character is revealed. The theme's code-surface colors arrive in the
same commit, so dark and light themes never flash against Smoothstream's fallback
surface. Unknown fence languages retain the selected palette while falling
back to ordinary unhighlighted code rather than blocking playback.

Attaching the code adapter also opts fenced blocks into Smoothstream's enhanced code
surface. It shows Shiki's canonical language name (or the original fence label
for an unknown language) and adds a copy button. Copy remains hidden and
unfocusable until the closing fence is known and the entire block has finished
revealing, then copies only the raw code. Without the optional adapter, fenced
code remains ordinary `<pre><code>` markup with no toolbar.

## Styling

Smoothstream automatically includes a standalone prose theme for headings,
paragraphs, links, lists, blockquotes, thematic breaks, inline code, fenced
code, tables, and images. It does not require Tailwind CSS and it does not
constrain the response width. The typographic scale and rhythm use Tailwind
Typography's `prose` treatment as a visual reference, with adjustments for
progressively revealed chat content.

The theme is scoped to `[data-smoothstream-theme="default"]`, is intentionally
unlayered so application resets cannot erase its out-of-the-box presentation,
and uses zero-specificity `:where()` selectors. Ordinary unlayered application
CSS can therefore override individual elements without `!important`. The
complete default palette is derived from one foreground token, so changing it
keeps body text, headings, markers, separators, quotes, and code surfaces in
the same color family:

```tsx
import { Smoothstream } from "@smoothstream/react";
import "./assistant-message.css";

<Smoothstream className="assistant-markdown" receiving={receiving}>
  {text}
</Smoothstream>
```

```css
.assistant-markdown {
  --smoothstream-foreground: #3b2a20;
}
```

Every derived value remains an independently overridable semantic token when a
design needs more precise control:

```css
.assistant-markdown {
  --smoothstream-heading-color: #7c2d12;
}
```

GFM task items remain real checked or unchecked disabled inputs. The default
theme removes only their browser-specific appearance and paints a consistent
one-rem box with an embedded SVG checkmark; the native state and accessibility
semantics remain unchanged. Its size, border, radius, checked fill, and check
image are independently replaceable, including its baseline position:

```css
.assistant-markdown {
  --smoothstream-task-size: 1rem;
  --smoothstream-task-offset: -1px;
  --smoothstream-task-border-color: #bdbdbd;
  --smoothstream-task-border-radius: 0.25rem;
  --smoothstream-task-checked-background: #0a0a0a;
  --smoothstream-task-check-image: url("./my-check.svg");
}
```

Smoothstream restores the platform checkbox in forced-colors mode. Setting
`unstyled` also leaves the browser's native checkbox appearance untouched.

Responsive tables use a stationary frame around a nested horizontal scroll
viewport. The semantic `table`, `th`, and `td` elements still own typography,
alignment, cell backgrounds, and cell borders. The supported
`[data-smoothstream-table-shell]` hook owns only the outer frame because the
table itself moves when its content overflows. The default theme exposes that
frame through dedicated variables:

```css
.assistant-markdown {
  --smoothstream-table-border-color: #d6d3d1;
  --smoothstream-table-border-width: 1px;
  --smoothstream-table-border-style: solid;
  --smoothstream-table-border-radius: 0.75rem;
}
```

When `unstyled` is set, custom or Tailwind-based CSS can style the same frame
directly. Use descendant selectors for the nested semantic table rather than
expecting it to be a direct child of the Markdown root:

```css
.assistant-markdown [data-smoothstream-table-shell] {
  border: 1px solid #d6d3d1;
  border-radius: 0.75rem;
}

.assistant-markdown table {
  /* Consumer typography and cell styling. */
}
```

Inline and fenced `code` use a system monospace stack. Body copy still
inherits the surrounding application font. The code face and sizes are
tokens; fenced size follows inline size unless you override it:

```css
.assistant-markdown {
  --smoothstream-font-mono: "JetBrains Mono", ui-monospace, monospace;
  --smoothstream-inline-code-font-size: 0.875em;
  --smoothstream-code-font-size: 0.8125em;
}
```

Fenced `pre` vertical margin is `--smoothstream-code-margin-block`. It defaults to `0.75em` (12px at a 16px host). The `pre` inherits the host size, so this follows the selected type size rather than the smaller code face.

`h1` type is `1.5em` (24px at a 16px host). Its vertical margins are `--smoothstream-h1-margin-block-start` (`1.5em`, 24px) and `--smoothstream-h1-margin-block-end` (`0.5em`, 8px), measured on the theme host so they do not grow with the heading’s own size. `h2` is `1.25em` (20px) with `--smoothstream-h2-margin-block-start` (`1.5em`, 24px) and `--smoothstream-h2-margin-block-end` (`0.25em`, 4px). `h3` is `1.125em` (18px) with `--smoothstream-h3-margin-block-start` (`1.25em`, 20px) and `--smoothstream-h3-margin-block-end` (`0.25em`, 4px). `h4` is `1em` (16px, weight 600) with `--smoothstream-h4-margin-block-start` / `--smoothstream-h4-margin-block-end` (`1em` / `0.25em`). `h5` and `h6` use the same size and margins with weight 400 (`--smoothstream-h5-margin-block-*`, `--smoothstream-h6-margin-block-*`). Paragraphs use `--smoothstream-p-margin-block-start` (`0.5em`, 8px) and `--smoothstream-p-margin-block-end` (`1em`, 16px). `ul` uses `--smoothstream-ul-margin-block-start` (`0.5em`, 8px) and `--smoothstream-ul-margin-block-end` (`1em`, 16px). `ol` uses `--smoothstream-ol-margin-block-start` / `--smoothstream-ol-margin-block-end` with the same defaults. Unordered list items use `--smoothstream-ul-li-margin-block` (`0.25em`, 4px). Ordered list items use `--smoothstream-ol-li-margin-block` with the same default. Nested lists use `--smoothstream-li-ul-margin-block` and `--smoothstream-li-ol-margin-block` (`0.25em`, 4px). Blockquotes use `--smoothstream-blockquote-margin-block` (`1em`, 16px). In a loose `ul` or `ol` item, the first paragraph has no top margin; later paragraphs keep the paragraph tokens. Horizontal rules use `--smoothstream-hr-margin-block` (`1.75em`, 28px). The table frame’s vertical margin is `--smoothstream-table-margin-block` (`0.5em`, 8px at a 16px host). Standalone images use `--smoothstream-image-margin-block` (`1.5em`, 24px). The first child of the Markdown root has no top margin and the last child has no bottom margin.

An installed Shiki theme supplies the fenced-code foreground and background.
Application tokens still take precedence when the surrounding design should
own that surface:

```css
.assistant-markdown {
  --smoothstream-code-background: #f7f5f2;
  --smoothstream-code-border-color: #d6d3d1;
  --smoothstream-code-color: #2f2925;
  --smoothstream-code-scrollbar-color: #a8a29e;
  --smoothstream-code-scrollbar-hover-color: #78716c;
}
```

To use Tailwind Typography or entirely custom prose styles, set `unstyled`.
Smoothstream's functional reveal CSS remains automatic:

```tsx
<Smoothstream className="prose max-w-none" unstyled>
  {text}
</Smoothstream>
```

## Accessibility

Smoothstream's Markdown root is ordinary semantic HTML, not a live region.
Do not place `aria-live`, `role="status"`, `role="log"`, or `role="alert"` on
the animated root or one of its ancestors: character admission and final DOM
compaction would turn visual reveal work into repeated assistive-technology
notifications.

Each mounted response instead owns a separate, permanently screen-reader-only
`role="status"` region outside the Markdown root. It remains empty while input
or presentation work is pending. After `receiving` is false, every planned unit
has finished, pending resources have resolved or failed, and temporary reveal
nodes have compacted back to semantic HTML, the region receives the single
polite announcement `Content ready.` The stable Markdown remains available for
normal screen-reader navigation by heading, list item, link, table cell, and
other native semantics; the live region does not duplicate that document.


## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run build` verifies the React client boundary, both adapters' automatic
CSS imports, and the DOM adapter's lack of framework dependencies. A
source-level boundary check keeps `@smoothstream/core` free of framework
imports, CSS, adapter source, and browser globals.

Tests mirror the source architecture under `test/core`, `test/markdown`,
`test/react`, `test/dom`, and `test/code`. Shared Markdown cases live in
`test/fixtures`; the prefix suite feeds every character-length prefix through
one persistent scheduler, while the React fixture suite verifies that settled
output matches ordinary static Markdown HTML. Core session tests separately
cover committed append-only input, playback and compaction snapshots, renderer
work discovery, and extension readiness. Test files are excluded from the
published package by the `files` allowlist in each package's `package.json`.

Use an even-numbered Node LTS release (Node 22 or 24+) for development.
