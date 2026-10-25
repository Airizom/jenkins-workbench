import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsBuildDetails, JenkinsWorkflowRun } from "../src/jenkins/types";
import { BuildDetailsPollingController } from "../src/panels/buildDetails/BuildDetailsPollingController";
import { ConsoleStreamManager } from "../src/panels/buildDetails/ConsoleStreamManager";

const buildUrl = "https://jenkins.example/job/example/1/";
const details: JenkinsBuildDetails = { number: 1, url: buildUrl, building: false };

function deferredDetails(): {
  promise: Promise<JenkinsBuildDetails>;
  resolve: (value: JenkinsBuildDetails) => void;
} {
  let resolve!: (value: JenkinsBuildDetails) => void;
  const promise = new Promise<JenkinsBuildDetails>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createController(
  getBuildDetails: () => Promise<JenkinsBuildDetails>,
  getWorkflowRun: () => Promise<JenkinsWorkflowRun | undefined> = async () => undefined,
  onErrors: (errors: string[]) => void = () => {},
  onComplete: (details: JenkinsBuildDetails) => void = () => {}
): BuildDetailsPollingController {
  return new BuildDetailsPollingController({
    statusBackend: { getBuildDetails, getWorkflowRun },
    testsBackend: {} as never,
    consoleBackend: {
      getConsoleTextTail: async () => ({
        text: "",
        truncated: false,
        bytesRead: 0,
        nextStart: 0,
        progressiveSupported: false
      }),
      getConsoleHtmlProgressive: async () => ({ html: "", textSize: 0, textSizeKnown: false })
    } as never,
    pendingInputsBackend: { getPendingInputActions: async () => [] } as never,
    environment: { environmentId: "env", scope: "global", url: "https://jenkins.example/" },
    buildUrl,
    maxConsoleChars: 100,
    getRefreshIntervalMs: () => 1,
    formatError: (error) => String(error),
    callbacks: {
      onDetails: () => {},
      onWorkflowRun: () => {},
      onWorkflowError: () => {},
      onPendingInputs: () => {},
      onTitle: () => {},
      onConsoleAppend: () => {},
      onConsoleSet: () => {},
      onConsoleHtmlAppend: () => {},
      onConsoleHtmlSet: () => {},
      onErrors,
      onComplete
    }
  });
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("BuildDetailsPollingController concurrent fetches", () => {
  it("handles an early workflow rejection while initial details are pending", async () => {
    const pending = deferredDetails();
    const failure = new Error("workflow failed");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const controller = createController(
      () => pending.promise,
      async () => {
        throw failure;
      }
    );

    try {
      const load = controller.loadInitial();
      await nextTurn();
      assert.deepEqual(unhandled, []);
      pending.resolve(details);
      const result = await load;
      assert.equal(result.details, details);
      assert.equal(result.workflowError, failure);
    } finally {
      pending.resolve(details);
      controller.dispose();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("handles an early console rejection while polled details are pending", async () => {
    const pending = deferredDetails();
    const failure = new Error("console failed");
    const errors: string[][] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let signalErrors!: () => void;
    const errorsPublished = new Promise<void>((resolve) => {
      signalErrors = resolve;
    });
    const fetchNext = vi
      .spyOn(ConsoleStreamManager.prototype, "fetchNext")
      .mockRejectedValue(failure);
    const controller = createController(
      () => {
        signalStarted();
        return pending.promise;
      },
      undefined,
      (value) => {
        errors.push(value);
        signalErrors();
      }
    );
    process.on("unhandledRejection", onUnhandled);

    try {
      controller.start();
      await started;
      await nextTurn();
      assert.deepEqual(unhandled, []);
      pending.resolve(details);
      await errorsPublished;
      assert.deepEqual(errors, [["Console output: Error: console failed"]]);
    } finally {
      pending.resolve(details);
      controller.dispose();
      fetchNext.mockRestore();
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports the same build details error from loadInitial and poll", async () => {
    let signalErrors!: () => void;
    const errorsPublished = new Promise<void>((resolve) => {
      signalErrors = resolve;
    });
    const polledErrors: string[][] = [];
    const controller = createController(
      async () => {
        throw new Error("details failed");
      },
      undefined,
      (value) => {
        polledErrors.push(value);
        signalErrors();
      }
    );

    try {
      const initial = await controller.loadInitial();
      assert.deepEqual(initial.errors, ["Build details: Error: details failed"]);
      controller.start();
      await errorsPublished;
      // The fake console backend only supports the initial text tail, so compare the shared entry.
      const buildDetailsError = (errors: string[] | undefined) =>
        errors?.find((error) => error.startsWith("Build details:"));
      assert.equal(buildDetailsError(polledErrors[0]), initial.errors[0]);
    } finally {
      controller.dispose();
    }
  });

  it("still reports completion when stopped during the completing poll's workflow fetch", async () => {
    let building = true;
    let workflowCalls = 0;
    let resolveWorkflow!: (value: JenkinsWorkflowRun | undefined) => void;
    let signalWorkflowStarted!: () => void;
    const workflowStarted = new Promise<void>((resolve) => {
      signalWorkflowStarted = resolve;
    });
    const completed: JenkinsBuildDetails[] = [];
    const controller = createController(
      async () => ({ ...details, building }),
      () => {
        workflowCalls += 1;
        if (workflowCalls === 1) {
          return Promise.resolve(undefined);
        }
        signalWorkflowStarted();
        return new Promise<JenkinsWorkflowRun | undefined>((resolve) => {
          resolveWorkflow = resolve;
        });
      },
      undefined,
      (value) => completed.push(value)
    );

    try {
      await controller.loadInitial();
      building = false;
      controller.start();
      await workflowStarted;
      controller.stop();
      resolveWorkflow(undefined);
      await nextTurn();
      assert.equal(completed.length, 1);
      assert.equal(completed[0]?.building, false);
    } finally {
      controller.dispose();
    }
  });
});
