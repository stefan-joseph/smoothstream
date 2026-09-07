# @smoothstream/vue

Deterministic, paced streaming Markdown for Vue 3 and Nuxt.

[Documentation](https://smoothstream.ai/docs/adapters/vue)

```sh
npm install @smoothstream/vue vue
```

```vue
<script setup lang="ts">
import { Smoothstream } from "@smoothstream/vue";
</script>

<template>
  <Smoothstream
    :markdown="message.content"
    :receiving="message.isStreaming"
  />
</template>
```

Streaming mode is the default. Render completed content such as previous chat
messages immediately with `mode="static"`:

```vue
<Smoothstream :markdown="previousMessage.content" mode="static" />
```

Each mounted component represents one append-only response. Give a different
response a new Vue `key`. Static rendering is SSR-safe; browser-only playback,
resource loading, highlighting, and clipboard work begin after mounting.

Pass Vue components for semantic elements produced by Markdown:

```vue
<script setup lang="ts">
import AppLink from "./AppLink.vue";

const components = { a: AppLink };
</script>

<template>
  <Smoothstream :components="components" :markdown="message.content" />
</template>
```

Overrides receive their content through the default slot. Preserve fallthrough
attributes so Smoothstream can retain its reveal, safety, layout, and
accessibility behavior. Fenced code and renderer-owned controls are not
component override targets.

Default reveal mechanics and prose styling are loaded automatically.
