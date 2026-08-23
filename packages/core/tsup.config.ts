import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: true,
  target: "es2022",
});
