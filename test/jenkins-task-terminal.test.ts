import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsTaskDefinition } from "../src/tasks/JenkinsTaskTypes";
import * as vscodeStub from "./helpers/vscodeStub";

interface TestRunRequest {
  waitForCompletion: boolean;
}

interface TestRunOutput {
  writeStatus(message: string): void;
  writeConsole(text: string): void;
}

interface TestRunResult {
  exitCode: number;
  outcome: string;
}

type RunBehavior = (
  request: TestRunRequest,
  output: TestRunOutput
) => Promise<TestRunResult> | TestRunResult;

const runnerInstances: TestJenkinsTaskRunner[] = [];
let runBehavior: RunBehavior = () => ({ exitCode: 0, outcome: "success" });

class TestJenkinsTaskRunner {
  cancelCalls = 0;
  request: TestRunRequest | undefined;

  constructor() {
    runnerInstances.push(this);
  }

  run(request: TestRunRequest, output: TestRunOutput): Promise<TestRunResult> {
    this.request = request;
    return Promise.resolve(runBehavior(request, output));
  }

  cancel(): void {
    this.cancelCalls++;
  }

  waitForCleanup(): Promise<void> {
    return Promise.resolve();
  }
}

const errorMessages: string[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showErrorMessage: (message: string) => {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    }
  }
}));
vi.doMock("../src/extension/ExtensionConfig", () => ({
  getExtensionConfiguration: () => ({}),
  getJenkinsTaskRunnerOptions: () => ({
    pollIntervalMs: 1,
    maxConsecutiveErrors: 1
  })
}));
vi.doMock("../src/tasks/JenkinsTaskRunner", () => ({
  JENKINS_TASK_EXIT_CODES: {
    success: 0,
    unstable: 1,
    failure: 2,
    notBuilt: 3,
    aborted: 4,
    error: 5,
    canceled: 130
  },
  JenkinsTaskRunner: TestJenkinsTaskRunner
}));

const { JenkinsTaskTerminal } = await import("../src/tasks/JenkinsTaskTerminal");

function createDefinition(overrides: Partial<JenkinsTaskDefinition> = {}): JenkinsTaskDefinition {
  return {
    type: "jenkinsWorkbench",
    environmentUrl: "https://jenkins.example/",
    environmentId: "env-1",
    jobUrl: "job/project/",
    ...overrides
  };
}

function createTerminal(definition = createDefinition()): InstanceType<typeof JenkinsTaskTerminal> {
  const environmentStore = {
    listEnvironmentsWithScope: async () => [
      {
        id: "env-1",
        scope: "workspace" as const,
        url: "https://jenkins.example/"
      }
    ]
  } as JenkinsEnvironmentStore;
  const refreshHost = {
    fullEnvironmentRefresh: vi.fn()
  };

  return new JenkinsTaskTerminal(
    definition,
    environmentStore,
    {} as JenkinsDataService,
    refreshHost
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for Jenkins task terminal test condition.");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value)
  };
}

beforeEach(() => {
  runnerInstances.length = 0;
  errorMessages.length = 0;
  runBehavior = () => ({ exitCode: 0, outcome: "success" });
});

describe("JenkinsTaskTerminal", () => {
  it("emits the runner's numeric exit code exactly once", async () => {
    runBehavior = () => ({ exitCode: 2, outcome: "failure" });
    const terminal = createTerminal();
    const closeCodes: number[] = [];
    terminal.onDidClose((exitCode) => closeCodes.push(exitCode));

    terminal.open();
    await waitUntil(() => closeCodes.length > 0);
    terminal.close();

    assert.deepEqual(closeCodes, [2]);
    assert.equal(typeof closeCodes[0], "number");
  });

  it("prefixes lifecycle status while preserving raw console text across CRLF chunks", async () => {
    runBehavior = (_request, output) => {
      output.writeStatus(
        "Following queue item 42.\nqueue/reason.c:7:3: error\rAPI detail continued"
      );
      output.writeConsole("src/main.c:4:2: error\r");
      output.writeConsole("\nsecond line\npartial");
      output.writeStatus("Build finished.");
      return { exitCode: 2, outcome: "failure" };
    };
    const terminal = createTerminal();
    const writes: string[] = [];
    const closeCodes: number[] = [];
    terminal.onDidWrite((text) => writes.push(text));
    terminal.onDidClose((exitCode) => closeCodes.push(exitCode));

    terminal.open();
    await waitUntil(() => closeCodes.length > 0);

    const output = writes.join("");
    assert.match(output, /\[Jenkins Workbench\] Following queue item 42\.\r\n/);
    assert.match(output, /\[Jenkins Workbench\] queue\/reason\.c:7:3: error\r\n/);
    assert.match(output, /\[Jenkins Workbench\] API detail continued\r\n/);
    assert.match(output, /src\/main\.c:4:2: error\r\nsecond line\r\npartial/);
    assert.match(output, /partial\r\n\[Jenkins Workbench\] Build finished\.\r\n/);
    assert.doesNotMatch(output, /\[Jenkins Workbench\] src\/main\.c/);
    assert.doesNotMatch(output, /(?:^|\r\n)queue\/reason\.c:7:3: error\r\n/);
  });

  it("passes submit-only mode through and closes successfully", async () => {
    const terminal = createTerminal(createDefinition({ waitForCompletion: false }));
    const closeCodes: number[] = [];
    terminal.onDidClose((exitCode) => closeCodes.push(exitCode));

    terminal.open();
    await waitUntil(() => closeCodes.length > 0);

    assert.equal(runnerInstances[0]?.request?.waitForCompletion, false);
    assert.deepEqual(closeCodes, [0]);
  });

  it("closes canceled tasks with 130 once and cancels the runner idempotently", async () => {
    const pending = deferred<TestRunResult>();
    runBehavior = () => pending.promise;
    const terminal = createTerminal();
    const closeCodes: number[] = [];
    terminal.onDidClose((exitCode) => closeCodes.push(exitCode));

    terminal.open();
    await waitUntil(() => runnerInstances.length === 1);
    terminal.close();
    terminal.close();

    assert.deepEqual(closeCodes, [130]);
    assert.equal(runnerInstances[0].cancelCalls, 1);

    pending.resolve({ exitCode: 0, outcome: "success" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(closeCodes, [130]);
  });

  it("closes with infrastructure failure when environment resolution rejects", async () => {
    const environmentStore = {
      listEnvironmentsWithScope: async () => {
        throw new Error("secret storage unavailable");
      }
    } as unknown as JenkinsEnvironmentStore;
    const terminal = new JenkinsTaskTerminal(
      createDefinition(),
      environmentStore,
      {} as JenkinsDataService,
      { fullEnvironmentRefresh: vi.fn() }
    );
    const closeCodes: number[] = [];
    terminal.onDidClose((exitCode) => closeCodes.push(exitCode));

    terminal.open();
    await waitUntil(() => closeCodes.length > 0);

    assert.deepEqual(closeCodes, [5]);
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /secret storage unavailable/);
  });
});
