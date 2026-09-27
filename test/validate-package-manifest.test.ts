import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const validatorPath = path.resolve("scripts/validate-package-manifest.mjs");
const fixtureDirectories: string[] = [];
const canonicalPackageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const canonicalTaskParametersSchema = canonicalPackageJson.contributes.taskDefinitions.find(
  (definition: { type?: string }) => definition.type === "jenkinsWorkbench"
).properties.parameters;

const createFixture = async (
  configurationSchema: object,
  taskParametersSchema: object = canonicalTaskParametersSchema,
  commandSource = 'registerCommand("jenkinsWorkbench.test", () => undefined);'
) => {
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "jenkins-workbench-manifest-"));
  fixtureDirectories.push(fixtureDirectory);

  const packageJson = {
    scripts: {
      "vscode:prepublish": "test",
      compile: "test",
      "build:webview": "test",
      "typecheck:webview": "test",
      check: "test",
      test: "test"
    },
    contributes: {
      commands: [{ command: "jenkinsWorkbench.test", title: "Test" }],
      configuration: {
        properties: { "jenkinsWorkbench.test": configurationSchema }
      },
      taskDefinitions: [
        {
          type: "jenkinsWorkbench",
          properties: { parameters: taskParametersSchema }
        }
      ]
    }
  };

  await mkdir(path.join(fixtureDirectory, "src", "commands"), { recursive: true });
  await Promise.all([
    writeFile(path.join(fixtureDirectory, "package.json"), JSON.stringify(packageJson)),
    writeFile(path.join(fixtureDirectory, "src", "commands", "test.ts"), commandSource)
  ]);

  return fixtureDirectory;
};

const runValidator = (cwd: string) =>
  spawnSync(process.execPath, [validatorPath], { cwd, encoding: "utf8" });

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("package manifest validator", () => {
  it("accepts a valid default and both supported task parameter forms", async () => {
    const cwd = await createFixture({ type: "number", default: 2, minimum: 1, maximum: 3 });

    const result = runValidator(cwd);

    expect(result.status).toBe(0);
  });

  it.each([
    '// registerCommand("jenkinsWorkbench.test", () => undefined);',
    "const example = 'registerCommand(\"jenkinsWorkbench.test\", () => undefined)';"
  ])("rejects a command registration found only in source text", async (commandSource) => {
    const cwd = await createFixture(
      { type: "boolean", default: true },
      canonicalTaskParametersSchema,
      commandSource
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jenkinsWorkbench.test is contributed but not registered");
  });

  it("rejects an invalid configuration default", async () => {
    const cwd = await createFixture({ type: "number", default: 0, minimum: 1 });

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jenkinsWorkbench.test.default does not match its schema");
  });

  it("rejects an unsupported contribution point", async () => {
    const cwd = await createFixture({ type: "boolean", default: true });
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.contributes.uriHandler = { scheme: "airizom.jenkins-workbench" };
    await writeFile(packageJsonPath, JSON.stringify(packageJson));

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "contributes.uriHandler is not a supported VS Code contribution point"
    );
  });

  it.each([
    [
      "map",
      { ...canonicalTaskParametersSchema, anyOf: [canonicalTaskParametersSchema.anyOf[1]] },
      "supported example 1"
    ],
    [
      "named list",
      { ...canonicalTaskParametersSchema, anyOf: [canonicalTaskParametersSchema.anyOf[0]] },
      "supported example 2"
    ]
  ])("rejects a task schema without the %s form", async (_name, schema, expectedError) => {
    const cwd = await createFixture({ type: "boolean", default: true }, schema);

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
  });

  describe("extension-host runtime imports", () => {
    const writeSource = async (cwd: string, relativePath: string, source: string) => {
      await mkdir(path.dirname(path.join(cwd, relativePath)), { recursive: true });
      await writeFile(path.join(cwd, relativePath), source);
    };
    const setDependencies = async (cwd: string, dependencies: Record<string, string>) => {
      const packageJsonPath = path.join(cwd, "package.json");
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      packageJson.dependencies = dependencies;
      await writeFile(packageJsonPath, JSON.stringify(packageJson));
    };

    it("accepts vscode, node builtins, declared dependencies, type-only and webview imports", async () => {
      const cwd = await createFixture({ type: "boolean", default: true });
      await setDependencies(cwd, { "@scope/runtime": "1.0.0" });
      await writeSource(
        cwd,
        "src/host.ts",
        [
          'import * as vscode from "vscode";',
          'import * as path from "node:path";',
          'import { spawn } from "child_process";',
          'import { run } from "@scope/runtime/sub";',
          'import type { Props } from "react";',
          'import { type Root } from "react-dom/client";',
          'export type { Other } from "some-dev-dependency";',
          'import { local } from "./local";'
        ].join("\n")
      );
      await writeSource(cwd, "src/panels/example/webview/App.ts", 'import React from "react";');
      await writeFile(path.join(cwd, ".vscodeignore"), "src/**\nout/**/*.map\n");

      const result = runValidator(cwd);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    });

    it.each([
      ['import { isSafePattern } from "redos-detector";', "imports redos-detector"],
      ['export { thing } from "undeclared";', "imports undeclared"],
      ['import "side-effect-only";', "imports side-effect-only"]
    ])("rejects an undeclared runtime import: %s", async (source, expectedError) => {
      const cwd = await createFixture({ type: "boolean", default: true });
      await writeSource(cwd, "src/host.ts", source);

      const result = runValidator(cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`src/host.ts ${expectedError}`);
    });

    it("rejects an undeclared import in a webview-path module the extension host imports", async () => {
      const cwd = await createFixture({ type: "boolean", default: true });
      await writeSource(
        cwd,
        "src/host.ts",
        'import { assets } from "./panels/shared/webview/Assets";'
      );
      await writeSource(cwd, "src/panels/shared/webview/Assets.ts", 'import "undeclared";');

      const result = runValidator(cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("src/panels/shared/webview/Assets.ts imports undeclared");
    });

    it.each(["node_modules/**", "/node_modules/", "node_modules"])(
      "rejects .vscodeignore excluding %s when dependencies are declared",
      async (pattern) => {
        const cwd = await createFixture({ type: "boolean", default: true });
        await setDependencies(cwd, { "redos-detector": "^6.1.4" });
        await writeFile(path.join(cwd, ".vscodeignore"), `src/**\n${pattern}\n`);

        const result = runValidator(cwd);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(".vscodeignore must not exclude node_modules");
      }
    );
  });
});
