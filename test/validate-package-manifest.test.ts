import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const validatorPath = path.resolve("scripts/validate-package-manifest.mjs");
const fixtureDirectories: string[] = [];

const parameterValueSchema = {
  type: ["string", "number", "boolean", "array"],
  items: { type: ["string", "number", "boolean"] }
};
const parameterMapSchema = {
  type: "object",
  additionalProperties: parameterValueSchema
};
const namedParametersSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["name", "value"],
    properties: {
      name: { type: "string" },
      value: parameterValueSchema
    },
    additionalProperties: false
  }
};

const createFixture = async (configurationSchema: object, taskParameterForms: object[]) => {
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
          properties: { parameters: { anyOf: taskParameterForms } }
        }
      ]
    }
  };

  await mkdir(path.join(fixtureDirectory, "src", "commands"), { recursive: true });
  await Promise.all([
    writeFile(path.join(fixtureDirectory, "package.json"), JSON.stringify(packageJson)),
    writeFile(
      path.join(fixtureDirectory, "src", "commands", "test.ts"),
      'registerCommand("jenkinsWorkbench.test", () => undefined);'
    )
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
    const cwd = await createFixture({ type: "number", default: 2, minimum: 1, maximum: 3 }, [
      parameterMapSchema,
      namedParametersSchema
    ]);

    const result = runValidator(cwd);

    expect(result.status).toBe(0);
  });

  it("rejects an invalid configuration default", async () => {
    const cwd = await createFixture({ type: "number", default: 0, minimum: 1 }, [
      parameterMapSchema,
      namedParametersSchema
    ]);

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("jenkinsWorkbench.test.default does not match its schema");
  });

  it("rejects an unsupported contribution point", async () => {
    const cwd = await createFixture({ type: "boolean", default: true }, [
      parameterMapSchema,
      namedParametersSchema
    ]);
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
    ["map", [namedParametersSchema], "supported example 1"],
    ["named list", [parameterMapSchema], "supported example 2"]
  ])("rejects a task schema without the %s form", async (_name, forms, expectedError) => {
    const cwd = await createFixture({ type: "boolean", default: true }, forms);

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
  });
});
