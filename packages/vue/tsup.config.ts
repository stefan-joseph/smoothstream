import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
  },
  external: [
    "@smoothstream/core",
    "@smoothstream/core/web",
    "@smoothstream/styles/base.css",
    "@smoothstream/styles/styles.css",
    "vue",
    /\.css$/u,
  ],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: true,
  target: "es2022",
  onSuccess: async () => {
    await Promise.all([
      copyFile("../styles/base.css", "dist/base.css"),
      copyFile("../styles/styles.css", "dist/styles.css"),
    ]);
  },
});
