# @smoothstream/react

Deterministic, paced streaming Markdown for React.

[Documentation](https://smoothstream.ai/docs/adapters/react)

```sh
npm install @smoothstream/react
```

```tsx
import { Smoothstream } from "@smoothstream/react";

<Smoothstream receiving={receiving}>
  {markdown}
</Smoothstream>
```

Streaming mode is the default. Render completed content such as previous chat
messages immediately without disabling interactive motion:

```tsx
<Smoothstream mode="static">
  {previousMessage.content}
</Smoothstream>
```

A mounted streaming component represents one append-only response. Keep it in
streaming mode when input closes so queued presentation can finish naturally:

```tsx
<Smoothstream receiving={receiving}>
  {activeResponse.content}
</Smoothstream>
```

Set `receiving` to `false` when no more Markdown will arrive. Use static mode
when mounting content that was already complete, and give a different response
a new React `key`.

Override semantic elements produced by Markdown with React components:

```tsx
import type { SmoothstreamComponents } from "@smoothstream/react";

const components: SmoothstreamComponents = {
  a: ({ children, ...props }) => <a {...props}>{children}</a>,
  inlineCode: ({ children, ...props }) => (
    <code {...props} className="app-inline-code">{children}</code>
  ),
};

<Smoothstream components={components}>{markdown}</Smoothstream>
```

Forward the supplied children and element properties so Smoothstream can retain
its reveal, safety, layout, and accessibility behavior. Fenced code and
renderer-owned controls are not component override targets.

Default reveal mechanics and prose styling are loaded automatically.
