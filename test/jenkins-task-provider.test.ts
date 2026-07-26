import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsTaskDefinition } from "../src/tasks/JenkinsTaskTypes";
import * as vscodeStub from "./helpers/vscodeStub";

type CustomExecutionCallback = (resolvedDefinition: vscode.TaskDefinition) => Promise<unknown>;

class TestCustomExecution {
  constructor(readonly callback: CustomExecutionCallback) {}
}

class TestTask {
  detail?: string;
  group?: vscode.TaskGroup;
  presentationOptions: vscode.TaskPresentationOptions = {};
  problemMatchers: string[] = [];
  runOptions: vscode.RunOptions = {};
  isBackground = false;

  constructor(
    readonly definition: vscode.TaskDefinition,
    readonly scope: vscode.TaskScope | vscode.WorkspaceFolder,
    readonly name: string,
    readonly source: string,
    readonly execution?: vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution
  ) {}
}

const taskScope = {
  Global: 1,
  Workspace: 2
} as const;
const defaultBuildGroup = { id: "build", isDefault: false };
const capturedTerminalDefinitions: JenkinsTaskDefinition[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  CustomExecution: TestCustomExecution,
  Task: TestTask,
  TaskGroup: {
    Build: defaultBuildGroup
  },
  TaskScope: taskScope,
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue?: T) => defaultValue
    })
  }
}));
vi.doMock("../src/tasks/JenkinsTaskTerminal", () => ({
  JenkinsTaskTerminal: class {
    constructor(definition: JenkinsTaskDefinition) {
      capturedTerminalDefinitions.push(definition);
    }

    open(): void {}

    close(): void {}
  }
}));

const { JenkinsTaskProvider } = await import("../src/tasks/JenkinsTaskProvider");

function createProvider(): InstanceType<typeof JenkinsTaskProvider> {
  return new JenkinsTaskProvider({} as JenkinsEnvironmentStore, {} as JenkinsDataService, {
    fullEnvironmentRefresh: vi.fn()
  });
}

describe("JenkinsTaskProvider.resolveTask", () => {
  it("preserves standard task properties", () => {
    const definition: JenkinsTaskDefinition = {
      type: "jenkinsWorkbench",
      environmentUrl: "https://jenkins.example/",
      jobUrl: "job/project/"
    };
    const input = new TestTask(
      definition,
      taskScope.Global,
      "Project build",
      "tasks.json"
    ) as unknown as vscode.Task;
    const customGroup = { id: "test", isDefault: true } as vscode.TaskGroup;
    const presentationOptions: vscode.TaskPresentationOptions = {
      echo: false,
      reveal: 2,
      panel: 2
    };
    const runOptions: vscode.RunOptions = {
      reevaluateOnRerun: false
    };
    input.detail = "Custom Jenkins task detail";
    input.group = customGroup;
    input.presentationOptions = presentationOptions;
    input.problemMatchers = ["$gcc", "$eslint-stylish"];
    input.runOptions = runOptions;
    input.isBackground = true;

    const resolved = createProvider().resolveTask(input);

    assert.ok(resolved);
    assert.equal(resolved.detail, input.detail);
    assert.equal(resolved.group, customGroup);
    assert.equal(resolved.presentationOptions, presentationOptions);
    assert.deepEqual(resolved.problemMatchers, ["$gcc", "$eslint-stylish"]);
    assert.notEqual(resolved.problemMatchers, input.problemMatchers);
    assert.equal(resolved.runOptions, runOptions);
    assert.equal(resolved.isBackground, true);
  });

  it("constructs the terminal from CustomExecution's resolved definition", async () => {
    capturedTerminalDefinitions.length = 0;
    const originalDefinition: JenkinsTaskDefinition = {
      type: "jenkinsWorkbench",
      environmentUrl: `\${config:jenkins.url}`,
      jobUrl: `job/\${input:job}/`
    };
    const resolvedDefinition: JenkinsTaskDefinition = {
      type: "jenkinsWorkbench",
      environmentUrl: "https://jenkins.example/",
      environmentId: "env-1",
      jobUrl: "job/resolved-project/",
      waitForCompletion: false
    };
    const input = new TestTask(
      originalDefinition,
      taskScope.Workspace,
      "Resolved project",
      "tasks.json"
    ) as unknown as vscode.Task;

    const resolvedTask = createProvider().resolveTask(input);
    assert.ok(resolvedTask);
    const execution = resolvedTask.execution as unknown as TestCustomExecution;
    await execution.callback(resolvedDefinition);

    assert.equal(capturedTerminalDefinitions.length, 1);
    assert.equal(capturedTerminalDefinitions[0], resolvedDefinition);
    assert.notEqual(capturedTerminalDefinitions[0], originalDefinition);
  });
});
