import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const publishingTools = ["@vscode/vsce@3.9.2", "ovsx@1.0.2"];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });

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
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npmCommand, [
    "install",
    "--no-save",
    "--prefer-offline",
    "--no-audit",
    "--no-fund",
    ...publishingTools
  ]);
};

const publish = async (artifactPath) => {
  if (!artifactPath) {
    throw new Error("publish requires the path to a VSIX artifact");
  }

  const packageJson = await readPackageJson();
  const version = validateTag(packageJson);
  const vscePat = requireSecret("VSCE_PAT");
  const ovsxPat = requireSecret("OVSX_PAT");
  const binaryPath = (name) => path.join("node_modules", ".bin", name);

  run(binaryPath("vsce"), [
    "publish",
    "--skip-duplicate",
    "--pat",
    vscePat,
    "--packagePath",
    artifactPath
  ]);

  const extensionId = `${packageJson.publisher}.${packageJson.name}`;
  const lookup = spawnSync(
    binaryPath("ovsx"),
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

  run(binaryPath("ovsx"), ["publish", artifactPath, "-p", ovsxPat]);
};

try {
  switch (process.argv[2]) {
    case "validate-tag":
      validateTag(await readPackageJson());
      break;
    case "install-tools":
      installTools();
      break;
    case "publish":
      await publish(process.argv[3]);
      break;
    default:
      throw new Error("Usage: release.mjs <validate-tag|install-tools|publish> [artifact-path]");
  }
} catch (error) {
  console.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
