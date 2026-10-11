import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const releasePath = path.resolve("scripts/release.mjs");
const fixtureDirectories: string[] = [];

interface ToolCall {
  command: string;
  args: string[];
  options: { shell?: boolean; stdio?: string; encoding?: string };
}

interface NpmResult {
  status: number | null;
  stdout: string;
  stderr?: string;
  error?: string;
}

const runRelease = async (
  platform: string,
  action: string,
  overrides: NodeJS.ProcessEnv = {},
  fixture: { expectedStatus?: number; npmResults?: (cwd: string) => NpmResult[] } = {}
) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "jenkins release & test-"));
  fixtureDirectories.push(cwd);
  const toolsDir = path.join(cwd, "jenkins-workbench-release-tools", "node_modules");
  const toolPaths = {
    vsce: path.join(toolsDir, "@vscode", "vsce", "bin", "vsce"),
    ovsx: path.join(toolsDir, "ovsx", "bin", "ovsx.js")
  };
  for (const [name, entrypoint] of Object.entries(toolPaths)) {
    const packageDir = path.dirname(path.dirname(entrypoint));
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ bin: name === "vsce" ? { vsce: "bin/vsce" } : "bin/ovsx.js" })
    );
  }
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({ name: "fixture", publisher: "test", version: "1.2.3" })
  );
  const extraneousPath = path.join(cwd, "node_modules", "extraneous");
  if (fixture.npmResults) {
    await mkdir(extraneousPath, { recursive: true });
  }

  // Intercept only the subprocess boundary: execute the real release script,
  // simulating Windows rejecting anything other than a native executable.
  const preload = path.join(cwd, "preload.mjs");
  const callsPath = path.join(cwd, "calls.jsonl");
  await writeFile(
    preload,
    `import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
Object.defineProperty(process, "platform", { value: process.env.TEST_PLATFORM });
const npmResults = JSON.parse(process.env.TEST_NPM_RESULTS);
childProcess.spawnSync = (command, args, options) => {
  appendFileSync(process.env.TEST_CALLS, JSON.stringify({ command, args, options }) + "\\n");
  if (command !== process.execPath && !(process.platform !== "win32" && command === "npm")) {
    return { error: new Error("Unsupported executable: " + command) };
  }
  const toolArgs = command === process.execPath ? args.slice(1) : args;
  const operation = toolArgs[0];
  if (operation === "ls" && toolArgs.includes("--json") && npmResults.length) {
    const result = npmResults.shift();
    if (result.error) result.error = new Error(result.error);
    return result;
  }
  return {
    status: operation === "get" ? Number(process.env.TEST_LOOKUP_STATUS ?? 1) : 0,
    stdout: operation === "ls" && toolArgs.includes("--json") ? "{}" : "",
    stderr: ""
  };
};
syncBuiltinESMExports();
`
  );
  const artifactPath = path.join(cwd, "artifact & release.vsix");
  const result = spawnSync(
    process.execPath,
    ["--import", preload, releasePath, action, artifactPath],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_execpath: "",
        RUNNER_TEMP: cwd,
        TEST_PLATFORM: platform,
        TEST_CALLS: callsPath,
        TEST_NPM_RESULTS: JSON.stringify(fixture.npmResults?.(cwd) ?? []),
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v1.2.3",
        VSCE_PAT: "fixture-vsce-secret",
        OVSX_PAT: "fixture-ovsx-secret",
        ...overrides
      }
    }
  );
  expect(result.error).toBeUndefined();
  if (!fixture.expectedStatus) {
    expect(result.stderr).toBe("");
  }
  expect(result.status).toBe(fixture.expectedStatus ?? 0);
  const calls: ToolCall[] = (await readFile(callsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const call of calls) {
    expect(call.options.shell).not.toBe(true);
    expect(call.args).not.toContain("fixture-vsce-secret");
    expect(call.args).not.toContain("fixture-ovsx-secret");
  }
  return { calls, toolPaths, artifactPath, cwd, extraneousPath, result };
};

const extraneousTree = (cwd: string) => {
  const extraneousPath = path.join(cwd, "node_modules", "extraneous");
  return {
    problems: [`extraneous: extraneous@1.0.0 ${extraneousPath}`],
    dependencies: { extraneous: { extraneous: true, path: extraneousPath } },
    error: { code: "ELSPROBLEMS" }
  };
};

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((cwd) => rm(cwd, { recursive: true })));
});

describe.each(["win32", "linux"])("release subprocesses on %s", (platform) => {
  it("installs publishing tools with npm", async () => {
    const { calls, cwd } = await runRelease(platform, "install-tools");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.command).toBe(platform === "win32" ? process.execPath : "npm");
    expect(call.args).toEqual([
      ...(platform === "win32"
        ? [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
        : []),
      "install",
      "--prefix",
      path.join(cwd, "jenkins-workbench-release-tools"),
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "@vscode/vsce@3.9.2",
      "ovsx@1.0.2"
    ]);
  });

  it("captures the production tree and packages through the vsce entrypoint", async () => {
    const { calls, toolPaths, artifactPath } = await runRelease(platform, "package");
    expect(calls).toHaveLength(4);
    for (const call of calls.slice(0, 2)) {
      expect(call.command).toBe(platform === "win32" ? process.execPath : "npm");
      expect(call.args.slice(platform === "win32" ? 1 : 0)).toEqual([
        "ls",
        "--omit=dev",
        "--all",
        "--long",
        "--json"
      ]);
      expect(call.options.encoding).toBe("utf8");
    }
    expect(calls.slice(2).map(({ command, args }) => ({ command, args }))).toEqual([
      { command: process.execPath, args: [toolPaths.vsce, "ls"] },
      { command: process.execPath, args: [toolPaths.vsce, "package", "-o", artifactPath] }
    ]);
  });

  it("removes extraneous packages after npm ls exits with ELSPROBLEMS and continues packaging", async () => {
    const { calls, extraneousPath, result } = await runRelease(
      platform,
      "package",
      {},
      {
        npmResults: (cwd) => [{ status: 1, stdout: JSON.stringify(extraneousTree(cwd)) }]
      }
    );
    await expect(stat(extraneousPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.stdout).toContain("Removing extraneous ");
    expect(calls).toHaveLength(4);
    expect(calls[3].args.slice(-3, -1)).toEqual(["package", "-o"]);
  });

  it.each(["missing", "invalid"])(
    "rejects %s dependencies even alongside extraneous packages",
    async (problem) => {
      const { calls, extraneousPath, result } = await runRelease(
        platform,
        "package",
        {},
        {
          expectedStatus: 1,
          npmResults: (cwd) => {
            const tree = extraneousTree(cwd);
            tree.problems.push(`${problem}: runtime@1.0.0`);
            return [{ status: 1, stdout: JSON.stringify(tree), stderr: `${problem} dependency` }];
          }
        }
      );
      expect((await stat(extraneousPath)).isDirectory()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(result.stderr).toContain(`${problem} dependency`);
    }
  );

  it.each(["execution", "status", "signal", "code", "json", "no problems", "unknown problem"])(
    "rejects npm ls failures: %s",
    async (failure) => {
      const { calls, extraneousPath } = await runRelease(
        platform,
        "package",
        {},
        {
          expectedStatus: 1,
          npmResults: (cwd) => {
            const tree = extraneousTree(cwd);
            if (failure === "code") tree.error.code = "EOTHER";
            if (failure === "no problems") tree.problems = [];
            if (failure === "unknown problem") tree.problems.push("unknown: runtime");
            return [
              {
                status: failure === "signal" ? null : failure === "status" ? 2 : 1,
                stdout: failure === "json" ? "invalid JSON" : JSON.stringify(tree),
                error: failure === "execution" ? "spawn failed" : undefined
              }
            ];
          }
        }
      );
      expect((await stat(extraneousPath)).isDirectory()).toBe(true);
      expect(calls).toHaveLength(1);
    }
  );

  it("requires npm ls to succeed when verifying dependencies after cleanup", async () => {
    const { calls } = await runRelease(
      platform,
      "package",
      {},
      {
        expectedStatus: 1,
        npmResults: (cwd) => [
          { status: 1, stdout: JSON.stringify(extraneousTree(cwd)) },
          { status: 1, stdout: JSON.stringify(extraneousTree(cwd)) }
        ]
      }
    );
    expect(calls).toHaveLength(2);
  });

  it.each([0, 1])("publishes with an Open VSX lookup status of %s", async (status) => {
    const { calls, toolPaths, artifactPath } = await runRelease(platform, "publish", {
      TEST_LOOKUP_STATUS: String(status)
    });
    expect(calls.map(({ command, args }) => ({ command, args }))).toEqual([
      {
        command: process.execPath,
        args: [toolPaths.vsce, "publish", "--skip-duplicate", "--packagePath", artifactPath]
      },
      {
        command: process.execPath,
        args: [toolPaths.ovsx, "get", "test.fixture", "--versionRange", "1.2.3", "--metadata"]
      },
      ...(status === 0
        ? []
        : [
            {
              command: process.execPath,
              args: [toolPaths.ovsx, "publish", artifactPath]
            }
          ])
    ]);
    expect(calls[1].options.stdio).toBe("ignore");
  });
});

it("uses the npm entrypoint supplied by an npm script on Windows", async () => {
  const npmEntrypoint = path.join(tmpdir(), "custom npm", "bin", "npm-cli.js");
  const { calls } = await runRelease("win32", "install-tools", { npm_execpath: npmEntrypoint });
  expect(calls[0].command).toBe(process.execPath);
  expect(calls[0].args[0]).toBe(npmEntrypoint);
});
