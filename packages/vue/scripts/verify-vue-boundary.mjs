import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.name !== "@smoothstream/vue") {
  throw new Error('package.json must be named "@smoothstream/vue".');
}
if (!manifest.peerDependencies?.vue) {
  throw new Error("Vue must remain a peer dependency.");
}
if (manifest.dependencies?.vue) {
  throw new Error("Vue must not be bundled as a runtime dependency.");
}
for (const sideEffect of ["./dist/index.js", "**/*.css"]) {
  if (!manifest.sideEffects?.includes(sideEffect)) {
    throw new Error(
      `package.json must preserve automatic CSS through ${sideEffect}.`,
    );
  }
}

const output = await readFile("dist/index.js", "utf8");
for (const cssImport of [
  'import "@smoothstream/styles/base.css";',
  'import "@smoothstream/styles/styles.css";',
]) {
  if (!output.includes(cssImport)) {
    throw new Error(`dist/index.js is missing automatic CSS import ${cssImport}.`);
  }
}
if (!output.includes('from "vue"')) {
  throw new Error("dist/index.js must keep Vue external.");
}
if (
  output.includes('from "react"') ||
  output.includes('from "react-dom"') ||
  output.includes("@smoothstream/dom") ||
  output.includes("@smoothstream/react")
) {
  throw new Error("The Vue adapter must not contain another renderer runtime.");
}

for (const file of [
  "dist/base.css",
  "dist/styles.css",
  "dist/index.d.ts",
]) {
  await readFile(file);
}

console.log("Verified Vue peer boundary, adapter isolation, and automatic CSS.");
