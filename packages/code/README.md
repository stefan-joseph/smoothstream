# @smoothstream/code

Optional Shiki syntax highlighting for Smoothstream renderers.

[Documentation](https://smoothstream.ai/docs/customize/syntax-highlighting)

```sh
npm install @smoothstream/react @smoothstream/code
# or
npm install @smoothstream/dom @smoothstream/code
```

```tsx
import { codeHighlighter } from "@smoothstream/code";
import { Smoothstream } from "@smoothstream/react";

<Smoothstream codeHighlighter={codeHighlighter}>
  {markdown}
</Smoothstream>
```

```ts
import { codeHighlighter } from "@smoothstream/code";
import { createSmoothstream } from "@smoothstream/dom";

createSmoothstream(container, { codeHighlighter });
```

Language labels are shown by default. Hide them globally while retaining syntax
highlighting and the copy control:

```ts
import { createCodeHighlighter } from "@smoothstream/code";

const codeHighlighter = createCodeHighlighter({
  showLanguageLabels: false,
});
```
