import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@smoothstream/core/web": fileURLToPath(
        new URL("./packages/core/src/web.ts", import.meta.url),
      ),
      "@smoothstream/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@smoothstream/dom": fileURLToPath(
        new URL("./packages/dom/src/index.ts", import.meta.url),
      ),
      "@smoothstream/react": fileURLToPath(
        new URL("./packages/react/src/index.ts", import.meta.url),
      ),
      "@smoothstream/vue": fileURLToPath(
        new URL("./packages/vue/src/index.ts", import.meta.url),
      ),
      "@smoothstream/styles/base.css": fileURLToPath(
        new URL("./packages/styles/base.css", import.meta.url),
      ),
      "@smoothstream/styles/styles.css": fileURLToPath(
        new URL("./packages/styles/styles.css", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
  },
});
