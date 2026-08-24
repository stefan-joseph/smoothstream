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

Default reveal mechanics and prose styling are loaded automatically.
