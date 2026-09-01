# @smoothstream/dom

Deterministic, paced streaming Markdown for the browser DOM.

[Documentation](https://smoothstream.ai/docs/adapters/vanilla)

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

Each controller represents one append-only response. Keep an active controller
in streaming mode when input closes and update its receiving state instead of
switching modes:

```ts
stream.update(completedMarkdown, { receiving: false });
```

Use static mode when creating a controller for content that was already
complete. Create a new controller to render a different response.

`codeHighlighter` is optional. Install `@smoothstream/code` only when fenced
code should be highlighted.

Call `stream.destroy()` when the containing view is removed.
