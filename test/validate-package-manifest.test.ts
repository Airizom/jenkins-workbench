import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Ajv from "ajv";
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

describe("schemas embedded in tasks.json and settings.json", () => {
  const ajv = new Ajv({ strict: false });
  // VS Code embeds contribution properties in new roots that do not contain `contributes`.
  const tasksSchema = {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: { parameters: canonicalTaskParametersSchema }
        }
      }
    }
  };
  const settingsSchema = {
    type: "object",
    properties: canonicalPackageJson.contributes.configuration.properties
  };
  const validateParameters = (parameters: unknown) =>
    ajv.validate(tasksSchema, { tasks: [{ type: "jenkinsWorkbench", parameters }] });
  const validateProfile = (profile: unknown) =>
    ajv.validate(settingsSchema, { "jenkinsWorkbench.diagnostics.profiles": { custom: profile } });

  it("accepts scalar and scalar-array parameter values in both task forms", () => {
    const values = ["main", 2, true, [], ["linux", 2, false]];
    expect(validateParameters(Object.fromEntries(values.map((value, i) => [i, value])))).toBe(true);
    expect(validateParameters(values.map((value, i) => ({ name: String(i), value })))).toBe(true);
  });

  it.each([null, {}, [null], [{}], [["nested"]]])(
    "rejects unsupported task parameter value %j in both forms",
    (value) => {
      expect(validateParameters({ branch: value })).toBe(false);
      expect(validateParameters([{ name: "branch", value }])).toBe(false);
    }
  );

  it("accepts parser names and single or multiline matcher patterns", () => {
    const builtIns = [
      "generic",
      "gcc-clang",
      "msvc",
      "typescript",
      "eslint",
      "rust",
      "go",
      "jvm-stack",
      "javascript-stack",
      "python-traceback",
      "dotnet-stack"
    ];
    const pattern = { regexp: "(.+):(\\d+): (.+)", file: 1, line: 2, message: 3 };
    expect(
      validateProfile({
        builtIns,
        matchers: builtIns.map((base) => ({ name: base, base, pattern }))
      })
    ).toBe(true);
    expect(validateProfile({ matchers: [{ name: "multiline", pattern: [pattern] }] })).toBe(true);
  });

  it("rejects unknown parser names in builtIns and matcher bases", () => {
    expect(validateProfile({ builtIns: ["unknown"] })).toBe(false);
    expect(validateProfile({ matchers: [{ name: "custom", base: "unknown" }] })).toBe(false);
  });

  it.each([{}, { regexp: "" }, { regexp: 1 }, { regexp: ".+", unexpected: true }])(
    "rejects invalid matcher pattern %j in both forms",
    (pattern) => {
      expect(validateProfile({ matchers: [{ name: "custom", pattern }] })).toBe(false);
      expect(validateProfile({ matchers: [{ name: "custom", pattern: [pattern] }] })).toBe(false);
    }
  );

  it.each([
    "file",
    "location",
    "line",
    "column",
    "endLine",
    "endColumn",
    "severity",
    "code",
    "message"
  ])("enforces capture group bounds for %s in both pattern forms", (field) => {
    for (const index of [0, 1, 100, 101, 1.5, "1"]) {
      const pattern = { regexp: "(.+)", [field]: index };
      const valid = index === 1 || index === 100;
      expect(validateProfile({ matchers: [{ name: "custom", pattern }] })).toBe(valid);
      expect(validateProfile({ matchers: [{ name: "custom", pattern: [pattern] }] })).toBe(valid);
    }
  });
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

  it.each([
    ["src/commands/nested/test.ts", 0],
    ["src/commands/webview/test.ts", 0],
    ["src/host.ts", 1],
    ["src/commands-other/test.ts", 1],
    ["src/commands/test.tsx", 1]
  ])("preserves command registration scope for %s", async (relativePath, expectedStatus) => {
    const cwd = await createFixture(
      { type: "boolean", default: true },
      canonicalTaskParametersSchema,
      ""
    );
    const sourcePath = path.join(cwd, relativePath);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "commands.registerCommand(`jenkinsWorkbench.test`, () => {});");

    const result = runValidator(cwd);

    expect(result.status).toBe(expectedStatus);
    if (expectedStatus === 1) {
      expect(result.stderr).toContain("jenkinsWorkbench.test is contributed but not registered");
    }
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
      ['import "side-effect-only";', "imports side-effect-only"],
      ['export async function load() { return await import("vitest"); }', "imports vitest"],
      ['const detector = () => require("redos-detector");', "imports redos-detector"],
      ['import detector = require("redos-detector");', "imports redos-detector"]
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

    it("follows relative dynamic imports into webview-path modules", async () => {
      const cwd = await createFixture({ type: "boolean", default: true });
      await writeSource(
        cwd,
        "src/host.ts",
        'export const load = () => import("./panels/shared/webview/Assets");'
      );
      await writeSource(cwd, "src/panels/shared/webview/Assets.ts", 'import "undeclared";');

      const result = runValidator(cwd);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("src/panels/shared/webview/Assets.ts imports undeclared");
    });

    it("ignores type-only import() references", async () => {
      const cwd = await createFixture({ type: "boolean", default: true });
      await writeSource(
        cwd,
        "src/host.ts",
        'export type Detector = typeof import("redos-detector");'
      );

      const result = runValidator(cwd);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
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
