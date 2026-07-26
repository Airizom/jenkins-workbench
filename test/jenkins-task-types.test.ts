import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import { JENKINS_TASK_TYPE, normalizeTaskDefinition } from "../src/tasks/JenkinsTaskTypes";

vi.doMock("vscode", () => ({ workspace: { getConfiguration: () => undefined } }));
const { getJenkinsTaskRunnerOptions } = await import("../src/extension/ExtensionConfig");

const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as {
  contributes: {
    configuration: {
      properties: Record<string, Record<string, unknown>>;
    };
    taskDefinitions: Array<{
      type: string;
      properties: Record<string, Record<string, unknown>>;
    }>;
  };
};

function createDefinition(overrides: Record<string, unknown> = {}): vscode.TaskDefinition {
  return {
    type: JENKINS_TASK_TYPE,
    environmentUrl: "https://jenkins.example.com",
    jobUrl: "job/api/",
    ...overrides
  };
}

function createConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      Object.hasOwn(values, key) ? (values[key] as T) : (defaultValue as T)
  } as vscode.WorkspaceConfiguration;
}

describe("normalizeTaskDefinition task-runner options", () => {
  it("defaults to waiting for completion and input steps", () => {
    const result = normalizeTaskDefinition(createDefinition());

    assert.equal(result.error, undefined);
    assert.equal(result.definition?.waitForCompletion, true);
    assert.equal(result.definition?.inputStepPolicy, "wait");
    assert.equal(result.definition?.inputTimeoutSeconds, undefined);
  });

  it("preserves valid explicit options", () => {
    const result = normalizeTaskDefinition(
      createDefinition({
        waitForCompletion: false,
        inputStepPolicy: "abort",
        inputTimeoutSeconds: 0.5
      })
    );

    assert.equal(result.error, undefined);
    assert.equal(result.definition?.waitForCompletion, false);
    assert.equal(result.definition?.inputStepPolicy, "abort");
    assert.equal(result.definition?.inputTimeoutSeconds, 0.5);
  });

  it.each([
    [{ waitForCompletion: "yes" }, "waitForCompletion must be a boolean."],
    [{ inputStepPolicy: "prompt" }, 'inputStepPolicy must be either "wait" or "abort".'],
    [{ inputTimeoutSeconds: 0 }, "inputTimeoutSeconds must be a positive finite number."],
    [{ inputTimeoutSeconds: Number.NaN }, "inputTimeoutSeconds must be a positive finite number."],
    [
      { inputTimeoutSeconds: Number.POSITIVE_INFINITY },
      "inputTimeoutSeconds must be a positive finite number."
    ]
  ])("rejects invalid options %j", (overrides, expectedError) => {
    const result = normalizeTaskDefinition(createDefinition(overrides));

    assert.equal(result.definition, undefined);
    assert.equal(result.error, expectedError);
  });
});

describe("getJenkinsTaskRunnerOptions", () => {
  it("uses the public defaults", () => {
    assert.deepEqual(getJenkinsTaskRunnerOptions(createConfig({})), {
      pollIntervalMs: 2000,
      maxConsecutiveErrors: 5
    });
  });

  it("clamps invalid, fractional, and below-minimum values", () => {
    assert.deepEqual(
      getJenkinsTaskRunnerOptions(
        createConfig({
          "taskRunner.pollIntervalSeconds": 0.25,
          "taskRunner.maxConsecutiveErrors": 2.9
        })
      ),
      {
        pollIntervalMs: 1000,
        maxConsecutiveErrors: 2
      }
    );
    assert.deepEqual(
      getJenkinsTaskRunnerOptions(
        createConfig({
          "taskRunner.pollIntervalSeconds": Number.NaN,
          "taskRunner.maxConsecutiveErrors": Number.POSITIVE_INFINITY
        })
      ),
      {
        pollIntervalMs: 2000,
        maxConsecutiveErrors: 5
      }
    );
  });
});

describe("Jenkins task-runner manifest contract", () => {
  const taskDefinition = packageJson.contributes.taskDefinitions.find(
    (definition) => definition.type === JENKINS_TASK_TYPE
  );

  it("publishes task defaults and validation", () => {
    assert.deepEqual(taskDefinition?.properties.waitForCompletion, {
      type: "boolean",
      default: true,
      description:
        "Wait for the queued Jenkins build to finish, stream its console output, and report its result as the task exit code. Set to false for submit-only behavior."
    });
    assert.deepEqual(taskDefinition?.properties.inputStepPolicy?.enum, ["wait", "abort"]);
    assert.equal(taskDefinition?.properties.inputStepPolicy?.default, "wait");
    assert.equal(taskDefinition?.properties.inputTimeoutSeconds?.exclusiveMinimum, 0);
  });

  it("publishes task-runner setting defaults and minimums", () => {
    const properties = packageJson.contributes.configuration.properties;

    assert.equal(properties["jenkinsWorkbench.taskRunner.pollIntervalSeconds"]?.default, 2);
    assert.equal(properties["jenkinsWorkbench.taskRunner.pollIntervalSeconds"]?.minimum, 1);
    assert.equal(properties["jenkinsWorkbench.taskRunner.maxConsecutiveErrors"]?.default, 5);
    assert.equal(properties["jenkinsWorkbench.taskRunner.maxConsecutiveErrors"]?.minimum, 1);
  });
});
