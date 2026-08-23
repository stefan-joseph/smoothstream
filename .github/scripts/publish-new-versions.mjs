#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const publishOrder = ["core", "styles", "code", "react", "dom"];

const runNpm = (args, options = {}) =>
  spawnSync("npm", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    ...options,
  });

const isMissingFromRegistry = (result) => {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status !== 0 && /E404|404 Not Found|is not in this registry/i.test(
    output,
  );
};

for (const directory of publishOrder) {
  const manifest = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "packages", directory, "package.json"),
      "utf8",
    ),
  );
  const { name, version } = manifest;
  const view = runNpm(["view", `${name}@${version}`, "version"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (view.status === 0 && view.stdout.trim() === version) {
    console.log(`Skipping ${name}@${version} (already on npm).`);
    continue;
  }

  if (view.status !== 0 && !isMissingFromRegistry(view)) {
    console.error(view.stderr || view.stdout);
    process.exit(view.status ?? 1);
  }

  console.log(`Publishing ${name}@${version}`);
  const publish = runNpm(
    ["publish", "--workspace", name, "--access", "public", "--provenance"],
    { stdio: "inherit" },
  );
  if (publish.status !== 0) {
    process.exit(publish.status ?? 1);
  }
}
