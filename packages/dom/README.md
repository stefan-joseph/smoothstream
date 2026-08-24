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

Streaming mode is the default. Use `mode: "static"` for completed Markdown that
should render immediately while retaining interactive control transitions.

```ts
const message = createSmoothstream(container, { mode: "static" });
message.update(previousMessage.content);
```

`codeHighlighter` is optional. Install `@smoothstream/code` only when fenced
code should be highlighted.

Call `stream.destroy()` when the containing view is removed.
