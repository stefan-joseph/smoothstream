# @smoothstream/react

Deterministic, paced streaming Markdown for React.

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

Default reveal mechanics and prose styling are loaded automatically.
