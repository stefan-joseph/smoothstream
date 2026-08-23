# @smoothstream/code

Optional Shiki syntax highlighting for Smoothstream renderers.

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
