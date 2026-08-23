import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(packageRoot, "src");

const frameworkPackages = [
  "@preact",
  "@solidjs",
  "@vue",
  "react",
  "react-dom",
  "vue",
  "preact",
  "svelte",
  "solid-js",
];

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const collectSourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(location);
      }
      return sourceExtensions.has(path.extname(entry.name)) ? [location] : [];
    }),
  );
  return files.flat();
};

const isFrameworkImport = (specifier) =>
  frameworkPackages.some(
    (packageName) =>
      specifier === packageName || specifier.startsWith(`${packageName}/`),
  );

const locationFor = (sourceFile, node) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return `${path.relative(packageRoot, sourceFile.fileName)}:${line + 1}:${
    character + 1
  }`;
};

const inspectSourceFile = async (file) => {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const violations = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isFrameworkImport(node.moduleSpecifier.text)
    ) {
      violations.push(
        `${locationFor(sourceFile, node.moduleSpecifier)} imports framework package "${node.moduleSpecifier.text}"`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
};

const manifest = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.name !== "@smoothstream/dom") {
  throw new Error('package.json must be named "@smoothstream/dom".');
}

const violations = [];
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const dependency of Object.keys(manifest[field] ?? {})) {
    if (isFrameworkImport(dependency)) {
      violations.push(
        `package.json ${field} includes framework package "${dependency}"`,
      );
    }
  }
}

const sourceFiles = (await collectSourceFiles(sourceRoot)).sort();
violations.push(
  ...(await Promise.all(sourceFiles.map(inspectSourceFile))).flat(),
);

if (violations.length > 0) {
  throw new Error(
    `@smoothstream/dom boundary violations:\n- ${violations.join("\n- ")}`,
  );
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
for (const file of ["dist/base.css", "dist/styles.css", "dist/index.d.ts"]) {
  await readFile(file);
}

console.log(
  `Verified published DOM boundaries, automatic CSS, and ${sourceFiles.length} source files.`,
);
