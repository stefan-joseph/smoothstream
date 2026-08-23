import { defineConfig } from "tsup";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
  },
  external: [
    "@smoothstream/core",
    "@smoothstream/styles/base.css",
    "@smoothstream/styles/styles.css",
    "react",
    "react-dom",
    "react/jsx-runtime",
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
  // tsup's optional Rollup pass strips module directives. Esbuild still
  // tree-shakes while preserving "use client" on the React entry points.
  treeshake: false,
});
