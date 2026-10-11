import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const publishingTools = ["@vscode/vsce@3.9.2", "ovsx@1.0.2"];
// Publishing tools live outside the project tree so vsce does not mistake them
// for runtime dependencies of the extension.
const toolsDir = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  "jenkins-workbench-release-tools"
);
const toolPath = (name) => {
  const packageDir = path.join(toolsDir, "node_modules", name === "vsce" ? "@vscode/vsce" : name);
  const packageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return path.resolve(
    packageDir,
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin[name]
  );
};
const npmCommand = "npm";

// Windows cannot spawn .cmd shims directly. Run the JavaScript entrypoints
// through Node, preserving argument boundaries without a command shell.
const spawnTool = (command, args, options) => {
  if (command === npmCommand && process.platform !== "win32") {
    return spawnSync(command, args, options);
  }

  const entrypoint =
    command === npmCommand
      ? process.env.npm_execpath ||
        path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
      : command;
  return spawnSync(process.execPath, [entrypoint, ...args], options);
};

const run = (command, args, options = {}) => {
  const result = spawnTool(command, args, { stdio: "inherit", ...options });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
};

const readPackageJson = async () =>
  JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));

const validateTag = (packageJson) => {
  if (process.env.GITHUB_REF_TYPE !== "tag") {
    throw new Error(
      `Releases must run from a tag, not a ${process.env.GITHUB_REF_TYPE ?? "missing ref type"}.`
    );
  }

  const tagName = process.env.GITHUB_REF_NAME ?? "";
  const tagVersion = tagName.startsWith("v") ? tagName.slice(1) : tagName;

  if (packageJson.version !== tagVersion) {
    throw new Error(
      `Tag (${tagVersion}) does not match package.json version (${packageJson.version}).`
    );
  }

  console.log(`Package version: ${packageJson.version}`);
  console.log(`Tag version:     ${tagVersion}`);

  return tagVersion;
};

const requireSecret = (name) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} secret is not set. Configure it in GitHub Actions secrets.`);
  }

  return value;
};

const installTools = () => {
  run(npmCommand, [
    "install",
    "--prefix",
    toolsDir,
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
    ...publishingTools
  ]);
};

const capture = (command, args) => {
  const result = spawnTool(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with status ${result.status}\n${result.stderr}`
    );
  }

  return result.stdout;
};

// Extraneous packages are skipped here; removeExtraneousPackages deletes them before packaging.
const collectProductionDirs = (node, dirs) => {
  for (const dependency of Object.values(node.dependencies ?? {})) {
    if (dependency.extraneous || !dependency.path) {
      continue;
    }

    const dir = path.relative(process.cwd(), dependency.path).split(path.sep).join("/");

    if (!dirs.has(dir)) {
      dirs.add(dir);
      collectProductionDirs(dependency, dirs);
    }
  }

  return dirs;
};

const packageDirOf = (file) => {
  const match = file.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\/package\.json$/);
  return match?.[1];
};

const readProductionTree = (allowExtraneous = false) => {
  const args = ["ls", "--omit=dev", "--all", "--long", "--json"];
  const result = spawnTool(npmCommand, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  if (result.error) {
    throw result.error;
  }

  const failure = () =>
    new Error(
      `${npmCommand} ${args.join(" ")} exited with status ${result.status}\n${result.stderr}`
    );
  let tree;
  try {
    tree = JSON.parse(result.stdout);
  } catch (error) {
    throw result.status === 0 ? error : failure();
  }
  // Older npm versions report extraneous packages as ELSPROBLEMS. Only cleanup
  // may recover from that result; dependency verification still requires success.
  const recoverable =
    allowExtraneous &&
    result.status === 1 &&
    tree.error?.code === "ELSPROBLEMS" &&
    Array.isArray(tree.problems) &&
    tree.problems.length > 0 &&
    tree.problems.every(
      (problem) => typeof problem === "string" && problem.startsWith("extraneous:")
    ) &&
    collectExtraneousPaths(tree, []).length > 0;

  if (result.status !== 0 && !recoverable) {
    throw failure();
  }

  return tree;
};

const collectExtraneousPaths = (node, paths) => {
  for (const dependency of Object.values(node.dependencies ?? {})) {
    if (dependency.extraneous && dependency.path) {
      paths.push(dependency.path);
    } else {
      collectExtraneousPaths(dependency, paths);
    }
  }

  return paths;
};

// Some npm versions (11.6.x on Linux) install the hoisted helpers of skipped
// wasm32 optional packages as extraneous. vsce ships anything npm lists, so
// remove them first; by definition nothing installed depends on them.
const removeExtraneousPackages = async () => {
  for (const extraneousPath of collectExtraneousPaths(readProductionTree(true), [])) {
    console.log(`Removing extraneous ${path.relative(process.cwd(), extraneousPath)}`);
    await rm(extraneousPath, { recursive: true, force: true });
  }
};

/**
 * The compiled extension loads runtime dependencies from node_modules, so the
 * VSIX must contain exactly the production dependency closure: nothing missing
 * (activation fails) and no development or publishing tooling (bloat).
 */
const verifyPackagedDependencies = () => {
  const expected = collectProductionDirs(readProductionTree(), new Set());
  const packaged = new Set(
    capture(toolPath("vsce"), ["ls"])
      .split(/\r?\n/)
      .map(packageDirOf)
      .filter((dir) => dir !== undefined)
  );
  const missing = [...expected].filter((dir) => !packaged.has(dir));
  const unexpected = [...packaged].filter((dir) => !expected.has(dir));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        "VSIX node_modules do not match the production dependency tree.",
        ...missing.map((dir) => `  missing: ${dir}`),
        ...unexpected.map((dir) => `  unexpected: ${dir}`)
      ].join("\n")
    );
  }

  console.log(`Packaging ${expected.size} runtime dependency packages.`);
};

const packageExtension = async (artifactPath) => {
  if (!artifactPath) {
    throw new Error("package requires the output path for the VSIX artifact");
  }

  await removeExtraneousPackages();
  verifyPackagedDependencies();
  run(toolPath("vsce"), ["package", "-o", artifactPath]);
};

const publish = async (artifactPath) => {
  if (!artifactPath) {
    throw new Error("publish requires the path to a VSIX artifact");
  }

  const packageJson = await readPackageJson();
  const version = validateTag(packageJson);
  // vsce and ovsx read VSCE_PAT/OVSX_PAT from the inherited environment; passing
  // them as arguments would expose the tokens in the process command line.
  requireSecret("VSCE_PAT");
  requireSecret("OVSX_PAT");
  run(toolPath("vsce"), ["publish", "--skip-duplicate", "--packagePath", artifactPath]);

  const extensionId = `${packageJson.publisher}.${packageJson.name}`;
  const lookup = spawnTool(
    toolPath("ovsx"),
    ["get", extensionId, "--versionRange", version, "--metadata"],
    { stdio: "ignore" }
  );

  if (lookup.error) {
    throw lookup.error;
  }

  if (lookup.status === 0) {
    console.log(`${extensionId}@${version} is already published to Open VSX; skipping.`);
    return;
  }

  run(toolPath("ovsx"), ["publish", artifactPath]);
};

try {
  switch (process.argv[2]) {
    case "validate-tag":
      validateTag(await readPackageJson());
      break;
    case "install-tools":
      installTools();
      break;
    case "package":
      await packageExtension(process.argv[3]);
      break;
    case "publish":
      await publish(process.argv[3]);
      break;
    default:
      throw new Error(
        "Usage: release.mjs <validate-tag|install-tools|package|publish> [artifact-path]"
      );
  }
} catch (error) {
  console.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
