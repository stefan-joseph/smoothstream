import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const requiredSideEffects = [
  "./dist/index.js",
  "**/*.css",
];

for (const sideEffect of requiredSideEffects) {
  if (!packageJson.sideEffects?.includes(sideEffect)) {
    throw new Error(
      `package.json must preserve automatic CSS through ${sideEffect}.`,
    );
  }
}

const clientEntries = new Map([
  [
    "dist/index.js",
    [
      'import "@smoothstream/styles/base.css";',
      'import "@smoothstream/styles/styles.css";',
    ],
  ],
]);

for (const [file, cssImports] of clientEntries) {
  const source = await readFile(file, "utf8");
  if (!source.startsWith('"use client";')) {
    throw new Error(`${file} is missing its use client directive.`);
  }
  for (const cssImport of cssImports) {
    if (!source.includes(cssImport)) {
      throw new Error(`${file} is missing automatic CSS import ${cssImport}.`);
    }
  }
}

const baseCss = await readFile("dist/base.css", "utf8");
if (!baseCss.includes("@keyframes smoothstream-text-in")) {
  throw new Error("dist/base.css is missing Smoothstream's reveal mechanics.");
}

const themeCss = await readFile("dist/styles.css", "utf8");
if (!themeCss.includes('[data-smoothstream-theme="default"]')) {
  throw new Error("dist/styles.css is missing the opt-out theme boundary.");
}

console.log("Verified published React boundaries and automatic CSS.");
