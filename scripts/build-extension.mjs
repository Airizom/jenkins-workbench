// Bundles the extension host (and the build-diagnostics matcher worker) into out/ with esbuild.
// One bundle instead of ~500 CommonJS modules keeps activation from paying a file read and
// module wrapper per source file. Webview assets are built separately by Vite into out/webview.
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "out");
const watch = process.argv.includes("--watch");

const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));

// Runtime dependencies stay external and ship in the VSIX node_modules; the release script and
// scripts/validate-package-manifest.mjs both rely on that split.
const external = ["vscode", ...Object.keys(packageJson.dependencies ?? {})];

// Remove per-module output from earlier tsc builds so stale files are never packaged.
const removeStaleOutput = async () => {
  const entries = await readdir(outDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name !== "webview")
      .map((entry) => rm(path.join(outDir, entry.name), { recursive: true, force: true }))
  );
};

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    extension: "src/extension.ts",
    // Loaded by path from BuildDiagnosticCustomMatcherWorkerClient via __dirname.
    BuildDiagnosticCustomMatcherWorker: "src/buildDiagnostics/BuildDiagnosticCustomMatcherWorker.ts"
  },
  outdir: outDir,
  bundle: true,
  platform: "node",
  format: "cjs",
  // VS Code 1.85 (the engines floor) runs extensions on Node 18.
  target: "node18",
  external,
  sourcemap: true,
  sourcesContent: false,
  logLevel: "info"
};

await removeStaleOutput();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
