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

const browserGlobals = new Set([
  "Animation",
  "DOMRect",
  "HTMLImageElement",
  "HTMLElement",
  "Image",
  "IntersectionObserver",
  "MutationObserver",
  "NodeFilter",
  "ResizeObserver",
  "clearInterval",
  "clearTimeout",
  "cancelAnimationFrame",
  "document",
  "getComputedStyle",
  "localStorage",
  "location",
  "matchMedia",
  "navigator",
  "performance",
  "requestAnimationFrame",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "window",
]);

const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const stylePattern = /\.(?:css|less|sass|scss)(?:\?.*)?$/u;

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

const isAdapterImport = (file, specifier) => {
  if (!specifier.startsWith(".")) {
    return false;
  }
  const resolved = path.resolve(path.dirname(file), specifier);
  return resolved
    .split(path.sep)
    .some((segment) => ["dom", "react", "vue"].includes(segment));
};

const isDeclarationName = (node) => {
  const parent = node.parent;
  return (
    (ts.isBindingElement(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isVariableDeclaration(parent)) &&
    parent.name === node
  );
};

const isNonReferencePropertyName = (node) => {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isMethodDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
      parent.name === node) ||
    ts.isImportClause(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent)
  );
};

const locationFor = (sourceFile, node) => {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return `${path.relative(packageRoot, sourceFile.fileName)}:${line + 1}:${
    character + 1
  }`;
};

const inspectModuleSpecifier = (sourceFile, node, specifier, violations) => {
  if (isFrameworkImport(specifier)) {
    violations.push(
      `${locationFor(sourceFile, node)} imports framework package "${specifier}"`,
    );
  }
  if (stylePattern.test(specifier)) {
    violations.push(
      `${locationFor(sourceFile, node)} imports stylesheet "${specifier}"`,
    );
  }
  if (isAdapterImport(sourceFile.fileName, specifier)) {
    violations.push(
      `${locationFor(sourceFile, node)} imports adapter source "${specifier}"`,
    );
  }
};

const inspectFile = async (file) => {
  const source = await readFile(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];

  const visit = (node) => {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use client"
    ) {
      violations.push(
        `${locationFor(sourceFile, node)} contains a "use client" directive`,
      );
    }

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      inspectModuleSpecifier(
        sourceFile,
        node.moduleSpecifier,
        node.moduleSpecifier.text,
        violations,
      );
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      inspectModuleSpecifier(
        sourceFile,
        node.arguments[0],
        node.arguments[0].text,
        violations,
      );
    }

    if (
      ts.isIdentifier(node) &&
      browserGlobals.has(node.text) &&
      !isDeclarationName(node) &&
      !isNonReferencePropertyName(node)
    ) {
      violations.push(
        `${locationFor(sourceFile, node)} uses browser global "${node.text}"`,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const files = (await collectSourceFiles(sourceRoot)).sort();
const violations = (await Promise.all(files.map(inspectFile))).flat();

const manifest = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
if (manifest.name !== "@smoothstream/core") {
  violations.push('package.json must be named "@smoothstream/core"');
}
if (manifest.sideEffects !== false) {
  violations.push("package.json must declare sideEffects: false");
}
for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const dependency of Object.keys(manifest[field] ?? {})) {
    if (isFrameworkImport(dependency)) {
      violations.push(
        `package.json ${field} includes framework package "${dependency}"`,
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `@smoothstream/core boundary violations:\n- ${violations.join("\n- ")}`,
  );
}

console.log(`Verified core package boundaries across ${files.length} files.`);
