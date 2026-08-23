# @smoothstream/dom

Deterministic, paced streaming Markdown for the browser DOM.

```sh
npm install @smoothstream/dom
```

```ts
import { createSmoothstream } from "@smoothstream/dom";
import { codeHighlighter } from "@smoothstream/code";

const stream = createSmoothstream(container, {
  receiving: true,
  codeHighlighter,
});
stream.update(markdown, { receiving });
```

`codeHighlighter` is optional. Install `@smoothstream/code` only when fenced
code should be highlighted.

Call `stream.destroy()` when the containing view is removed.
