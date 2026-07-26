import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import {
  JENKINS_TASK_EXIT_CODES,
  JenkinsTaskRunner,
  type JenkinsTaskBuildDetails,
  type JenkinsTaskPendingInputSummary,
  type JenkinsTaskProgressiveConsoleResult,
  type JenkinsTaskQueueItem,
  type JenkinsTaskRunRequest,
  type JenkinsTaskRunnerBackend,
  mapJenkinsBuildResult
} from "../src/tasks/JenkinsTaskRunner";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const baseRequest: JenkinsTaskRunRequest = {
  environment,
  jobUrl: "https://jenkins.example/job/example/",
  allowEmptyParams: false,
  waitForCompletion: true,
  inputStepPolicy: "wait"
};

const singleTriggerActions = [{ causes: [{}] }];

class FakeBackend implements JenkinsTaskRunnerBackend {
  queuedItemsBeforeTrigger: Array<{ id: number }> = [];
  queueLocation: string | undefined = "https://jenkins.example/queue/item/41/";
  queueItems: JenkinsTaskQueueItem[] = [
    { id: 41, executable: { number: 7, url: "https://wrong.example/job/other/99/" } }
  ];
  buildDetails: JenkinsTaskBuildDetails[] = [
    {
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: false,
      result: "SUCCESS",
      actions: singleTriggerActions
    }
  ];
  progressiveResults: Array<JenkinsTaskProgressiveConsoleResult | Error> = [
    { text: "", textSize: 0, moreData: false, bytesRead: 0 }
  ];
  fullConsoleText = "";
  inputSummaries: Array<JenkinsTaskPendingInputSummary | Error> = [
    { awaitingInput: false, count: 0, fetchedAt: 0 }
  ];
  triggerCalls = 0;
  parameterTriggerCalls = 0;
  queueCalls = 0;
  buildCalls = 0;
  progressiveCalls = 0;
  fullConsoleCalls = 0;
  fullConsoleMaxBytes: number[] = [];
  buildDetailOptions: Array<
    { includeCauses?: boolean; includeParameters?: boolean; statusOnly?: boolean } | undefined
  > = [];
  inputCalls = 0;
  cancelQueueCalls: number[] = [];
  stoppedBuilds: string[] = [];
  lastParameters: URLSearchParams | undefined;
  lastAllowEmptyParams: boolean | undefined;

  async getQueueItems(): Promise<Array<{ id: number }>> {
    return this.queuedItemsBeforeTrigger;
  }

  async triggerBuild(): Promise<{ queueLocation?: string }> {
    this.triggerCalls++;
    return { queueLocation: this.queueLocation };
  }

  async triggerBuildWithParameters(
    _environment: JenkinsEnvironmentRef,
    _jobUrl: string,
    parameters?: URLSearchParams,
    options?: { allowEmptyParams?: boolean }
  ): Promise<{ queueLocation?: string }> {
    this.parameterTriggerCalls++;
    this.lastParameters = parameters;
    this.lastAllowEmptyParams = options?.allowEmptyParams;
    return { queueLocation: this.queueLocation };
  }

  async getQueueItem(): Promise<JenkinsTaskQueueItem> {
    this.queueCalls++;
    return shiftOrLast(this.queueItems);
  }

  async cancelQueueItem(_environment: JenkinsEnvironmentRef, queueId: number): Promise<void> {
    this.cancelQueueCalls.push(queueId);
  }

  async getBuildDetails(
    _environment?: JenkinsEnvironmentRef,
    _buildUrl?: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean; statusOnly?: boolean }
  ): Promise<JenkinsTaskBuildDetails> {
    this.buildCalls++;
    this.buildDetailOptions.push(options);
    const details = shiftOrLast(this.buildDetails);
    return options?.includeCauses && details.actions === undefined
      ? { ...details, actions: singleTriggerActions }
      : details;
  }

  async getConsoleTextProgressive(): Promise<JenkinsTaskProgressiveConsoleResult> {
    this.progressiveCalls++;
    const result = shiftOrLast(this.progressiveResults);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  async getConsoleTextHead(
    _environment: JenkinsEnvironmentRef,
    _buildUrl: string,
    maxBytes: number
  ): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
    this.fullConsoleCalls++;
    this.fullConsoleMaxBytes.push(maxBytes);
    return {
      text: this.fullConsoleText,
      truncated: false,
      bytesRead: Buffer.byteLength(this.fullConsoleText)
    };
  }

  async getPendingInputSummary(): Promise<JenkinsTaskPendingInputSummary> {
    this.inputCalls++;
    const result = shiftOrLast(this.inputSummaries);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  async stopBuild(_environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    this.stoppedBuilds.push(buildUrl);
  }
}

function shiftOrLast<T>(values: T[]): T {
  const value = values.length > 1 ? values.shift() : values[0];
  if (value === undefined) {
    throw new Error("Fake response sequence is empty.");
  }
  return value;
}

function outputCollector(): {
  statuses: string[];
  console: string[];
  cleanupErrors: string[];
  output: {
    writeStatus(message: string): void;
    writeConsole(text: string): void;
    onCleanupError(message: string): void;
  };
} {
  const statuses: string[] = [];
  const console: string[] = [];
  const cleanupErrors: string[] = [];
  return {
    statuses,
    console,
    cleanupErrors,
    output: {
      writeStatus: (message) => statuses.push(message),
      writeConsole: (text) => console.push(text),
      onCleanupError: (message) => cleanupErrors.push(message)
    }
  };
}

function immediateRunner(
  backend: JenkinsTaskRunnerBackend,
  overrides?: {
    maxConsecutiveErrors?: number;
    maxFullConsoleBytes?: number;
    clock?: { value: number };
  }
): JenkinsTaskRunner {
  const clock = overrides?.clock ?? { value: 0 };
  return new JenkinsTaskRunner(backend, {
    pollIntervalMs: 1000,
    maxConsecutiveErrors: overrides?.maxConsecutiveErrors ?? 3,
    maxFullConsoleBytes: overrides?.maxFullConsoleBytes,
    now: () => clock.value,
    delay: async (milliseconds) => {
      clock.value += milliseconds;
    }
  });
}

describe("JenkinsTaskRunner result mapping", () => {
  it.each([
    ["SUCCESS", 0, "success"],
    ["UNSTABLE", 1, "unstable"],
    ["FAILURE", 2, "failure"],
    ["FAILED", 2, "failure"],
    ["ERROR", 2, "failure"],
    ["NOT_BUILT", 3, "notBuilt"],
    ["ABORTED", 4, "aborted"],
    ["future-result", 5, "error"],
    [undefined, 5, "error"]
  ] as const)("maps %s to exit code %s", (jenkinsResult, exitCode, outcome) => {
    const result = mapJenkinsBuildResult(jenkinsResult);
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.outcome, outcome);
  });
});

describe("JenkinsTaskRunner lifecycle", () => {
  it("follows the exact queue item, streams raw console lines, and reports success", async () => {
    const backend = new FakeBackend();
    backend.queueItems = [
      {
        id: 41,
        why: "Waiting for next available executor on linux && docker",
        assignedLabel: { name: "linux && docker" },
        buildable: true
      },
      {
        id: 41,
        why: "Waiting for next available executor on linux && docker",
        buildable: true
      },
      { id: 41, executable: { number: 7 } }
    ];
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      }
    ];
    backend.progressiveResults = [
      { text: "src/a.c:1:2: error\r", textSize: 21, moreData: true, bytesRead: 21 },
      { text: "\nfinished\n", textSize: 31, moreData: false, bytesRead: 10 },
      { text: "", textSize: 31, moreData: false, bytesRead: 0 }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(result.buildUrl, "https://jenkins.example/job/example/7/");
    assert.equal(collected.console.join(""), "src/a.c:1:2: error\nfinished\n");
    assert.equal(
      collected.statuses.filter((status) => status.includes("Waiting for next")).length,
      1
    );
    assert.equal(
      collected.console.some((line) => line.includes("[Jenkins Workbench]")),
      false
    );
    assert.equal(backend.buildDetailOptions[0]?.includeCauses, true);
    assert.ok(
      backend.buildDetailOptions.slice(1).every((options) => options?.statusOnly === true),
      "task polling should request causes once, then only build status fields"
    );
  });

  it("fails closed when Jenkins omits queue attribution", async () => {
    const backend = new FakeBackend();
    backend.queueLocation = undefined;
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.match(result.error ?? "", /may still have been submitted/);
    assert.equal(backend.queueCalls, 0);
  });

  it("preserves submit-only behavior without requiring a queue location", async () => {
    const backend = new FakeBackend();
    backend.queueLocation = undefined;
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(
      { ...baseRequest, waitForCompletion: false },
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(result.outcome, "submitted");
    assert.equal(backend.queueCalls, 0);
  });

  it("uses the parameterized trigger path, including an explicitly empty payload", async () => {
    const backend = new FakeBackend();
    const parameters = new URLSearchParams([
      ["target", "linux"],
      ["target", "docker"]
    ]);

    const result = await immediateRunner(backend).run(
      {
        ...baseRequest,
        allowEmptyParams: true,
        parameters,
        waitForCompletion: false
      },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(backend.triggerCalls, 0);
    assert.equal(backend.parameterTriggerCalls, 1);
    assert.equal(backend.lastParameters?.toString(), "target=linux&target=docker");
    assert.equal(backend.lastAllowEmptyParams, true);
  });

  it("returns aborted when Jenkins cancels the queue item", async () => {
    const backend = new FakeBackend();
    backend.queueItems = [{ id: 41, cancelled: true }];

    const result = await immediateRunner(backend).run(baseRequest, outputCollector().output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(result.jenkinsResult, "ABORTED");
  });

  it("falls back to full console text by UTF-8 byte offset without duplicating output", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      }
    ];
    backend.progressiveResults = [
      { text: "α\n", textSize: 3, moreData: false, bytesRead: 3 },
      new Error("progressive unsupported"),
      new Error("progressive unsupported")
    ];
    backend.fullConsoleText = "α\nβ\n";
    const collected = outputCollector();

    const result = await immediateRunner(backend, { maxConsecutiveErrors: 2 }).run(
      baseRequest,
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(collected.console.join(""), "α\nβ\n");
    assert.ok(backend.fullConsoleCalls >= 1);
    assert.ok(backend.fullConsoleMaxBytes.every((maxBytes) => maxBytes === 32 * 1024 * 1024));
  });

  it.each([404, 405])(
    "switches immediately to bounded fallback when progressive console returns %s",
    async (statusCode) => {
      const backend = new FakeBackend();
      backend.progressiveResults = [
        Object.assign(new Error("progressive console unsupported"), { statusCode })
      ];
      const collected = outputCollector();

      const result = await immediateRunner(backend).run(baseRequest, collected.output);

      assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
      assert.equal(backend.progressiveCalls, 1);
      assert.ok(backend.fullConsoleCalls >= 1);
      assert.equal(
        collected.statuses.some((status) => status.includes("Progressive console unavailable")),
        false
      );
      assert.ok(collected.statuses.some((status) => status.includes("unsupported")));
    }
  );

  it("keeps retrying transient progressive-console failures", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      }
    ];
    backend.progressiveResults = [
      Object.assign(new Error("temporary Jenkins failure"), { statusCode: 500 }),
      { text: "", textSize: 0, moreData: false, bytesRead: 0 }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.ok(backend.progressiveCalls >= 2);
    assert.equal(backend.fullConsoleCalls, 0);
    assert.ok(
      collected.statuses.some((status) => status.includes("Progressive console unavailable"))
    );
  });

  it("stops the attributed build when all console retrieval fails", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.progressiveResults = [new Error("no progressive log")];
    backend.getConsoleTextHead = async () => {
      throw new Error("no full log");
    };

    const result = await immediateRunner(backend, { maxConsecutiveErrors: 1 }).run(
      baseRequest,
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
  });

  it("fails immediately when bounded full-console fallback reaches its safety limit", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.progressiveResults = [new Error("progressive unsupported")];
    backend.getConsoleTextHead = async (_environment, _buildUrl, maxBytes) => {
      backend.fullConsoleCalls++;
      backend.fullConsoleMaxBytes.push(maxBytes);
      return {
        text: "bounded prefix",
        truncated: true,
        bytesRead: maxBytes
      };
    };

    const result = await immediateRunner(backend, {
      maxConsecutiveErrors: 1,
      maxFullConsoleBytes: 4096
    }).run(baseRequest, outputCollector().output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.match(result.error ?? "", /4096 bytes fallback safety limit/);
    assert.equal(backend.fullConsoleCalls, 1);
    assert.deepEqual(backend.fullConsoleMaxBytes, [4096]);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
  });

  it("uses exponential delays for consecutive queue errors", async () => {
    const backend = new FakeBackend();
    let queueAttempt = 0;
    backend.getQueueItem = async () => {
      queueAttempt++;
      if (queueAttempt < 3) {
        throw new Error("temporary queue failure");
      }
      return { id: 41, executable: { number: 7 } };
    };
    const delays: number[] = [];
    const runner = new JenkinsTaskRunner(backend, {
      pollIntervalMs: 100,
      maxConsecutiveErrors: 4,
      now: () => 0,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });

    const result = await runner.run(baseRequest, outputCollector().output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.deepEqual(delays.slice(0, 2), [100, 200]);
  });

  it("recovers from build-status errors below the retry limit", async () => {
    const backend = new FakeBackend();
    let attempts = 0;
    backend.getBuildDetails = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("temporary build API failure");
      }
      return {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      };
    };

    const result = await immediateRunner(backend, { maxConsecutiveErrors: 3 }).run(
      baseRequest,
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(attempts, 3);
    assert.deepEqual(backend.stoppedBuilds, []);
  });

  it("does not stop an unverified build when build-status retries are exhausted", async () => {
    const backend = new FakeBackend();
    const collected = outputCollector();
    backend.getBuildDetails = async () => {
      throw new Error("build API unavailable");
    };

    const result = await immediateRunner(backend, { maxConsecutiveErrors: 2 }).run(
      baseRequest,
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.match(result.error ?? "", /build status/);
    assert.deepEqual(backend.stoppedBuilds, []);
    assert.equal(collected.cleanupErrors.length, 1);
  });

  it("stops the build when input-status retries are exhausted", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.inputSummaries = [new Error("input API unavailable")];

    const result = await immediateRunner(backend, { maxConsecutiveErrors: 2 }).run(
      baseRequest,
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.match(result.error ?? "", /input steps/);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
  });

  it("flushes a partial final console line before completion status", async () => {
    const backend = new FakeBackend();
    backend.progressiveResults = [
      { text: "partial final line", textSize: 18, moreData: false, bytesRead: 18 },
      { text: "", textSize: 18, moreData: false, bytesRead: 0 }
    ];
    const events: string[] = [];
    const runner = immediateRunner(backend);

    const result = await runner.run(baseRequest, {
      writeStatus: (message) => events.push(`status:${message}`),
      writeConsole: (text) => events.push(`console:${text}`)
    });

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    const consoleIndex = events.indexOf("console:partial final line");
    const completionIndex = events.findIndex((event) =>
      event.includes("status:Jenkins build completed")
    );
    assert.ok(consoleIndex >= 0);
    assert.ok(completionIndex > consoleIndex);
  });

  it("streams unterminated console chunks without buffering the whole line", async () => {
    const backend = new FakeBackend();
    const firstChunk = "x".repeat(4096);
    const secondChunk = "tail";
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      }
    ];
    backend.progressiveResults = [
      {
        text: firstChunk,
        textSize: firstChunk.length,
        moreData: false,
        bytesRead: firstChunk.length
      },
      {
        text: secondChunk,
        textSize: firstChunk.length + secondChunk.length,
        moreData: false,
        bytesRead: secondChunk.length
      },
      {
        text: "",
        textSize: firstChunk.length + secondChunk.length,
        moreData: false,
        bytesRead: 0
      }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.deepEqual(collected.console, [firstChunk, secondChunk]);
  });

  it("uses the normal poll delay when a running build has no buffered console bytes", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      },
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: false,
        result: "SUCCESS"
      }
    ];
    backend.progressiveResults = [
      { text: "", textSize: 0, moreData: true, bytesRead: 0 },
      { text: "", textSize: 0, moreData: false, bytesRead: 0 }
    ];
    const delays: number[] = [];
    const runner = new JenkinsTaskRunner(backend, {
      pollIntervalMs: 100,
      delay: async (milliseconds) => {
        delays.push(milliseconds);
      }
    });

    const result = await runner.run(baseRequest, outputCollector().output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.deepEqual(delays, [100]);
  });

  it("finishes final console draining when X-More-Data stays true at a stable offset", async () => {
    const backend = new FakeBackend();
    backend.progressiveResults = [
      { text: "done", textSize: 4, moreData: true, bytesRead: 4 },
      { text: "", textSize: 4, moreData: true, bytesRead: 0 }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(backend.progressiveCalls, 4);
    assert.ok(collected.statuses.some((status) => status.includes("stable offset")));
  });

  it("keeps draining when final under-sized chunks advance the console offset", async () => {
    const backend = new FakeBackend();
    backend.progressiveResults = [
      { text: "first\n", textSize: 6, moreData: true, bytesRead: 6 },
      { text: "second\n", textSize: 13, moreData: true, bytesRead: 7 },
      { text: "late\n", textSize: 18, moreData: false, bytesRead: 5 },
      { text: "", textSize: 18, moreData: false, bytesRead: 0 }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(baseRequest, collected.output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.success);
    assert.equal(collected.console.join(""), "first\nsecond\nlate\n");
    assert.equal(backend.progressiveCalls, 4);
  });
});

describe("JenkinsTaskRunner input steps and cancellation", () => {
  it("starts each input timeout when the input response is observed", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    let stoppedAt: number | undefined;
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: stoppedAt === undefined,
      result: stoppedAt === undefined ? undefined : "ABORTED",
      actions: singleTriggerActions
    });
    backend.getPendingInputSummary = async () => {
      backend.inputCalls++;
      if (backend.inputCalls === 1) {
        clock.value += 6000;
      }
      return {
        awaitingInput: true,
        count: 1,
        signature: "slow-gate",
        message: "Approve?",
        fetchedAt: clock.value
      };
    };
    backend.stopBuild = async (_environment, buildUrl) => {
      stoppedAt = clock.value;
      backend.stoppedBuilds.push(buildUrl);
    };

    const result = await immediateRunner(backend, { clock }).run(
      { ...baseRequest, inputTimeoutSeconds: 5 },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(stoppedAt, 11_000);
  });

  it("spaces failed pending-input reads at least five seconds apart", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    const inputPollTimes: number[] = [];
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.getPendingInputSummary = async () => {
      backend.inputCalls++;
      inputPollTimes.push(clock.value);
      throw new Error("input API unavailable");
    };

    const result = await immediateRunner(backend, {
      clock,
      maxConsecutiveErrors: 2
    }).run(baseRequest, outputCollector().output);

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.deepEqual(inputPollTimes, [0, 5000]);
  });

  it("stops a build when an input gate exceeds its timeout", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "gate-1",
        message: "Deploy?",
        fetchedAt: 0
      }
    ];
    backend.getBuildDetails = async () => {
      backend.buildCalls++;
      if (backend.stoppedBuilds.length > 0) {
        return {
          number: 7,
          url: "https://jenkins.example/job/example/7/",
          building: false,
          result: "ABORTED",
          actions: singleTriggerActions
        };
      }
      return { ...shiftOrLast(backend.buildDetails), actions: singleTriggerActions };
    };

    const result = await immediateRunner(backend, { clock }).run(
      { ...baseRequest, inputTimeoutSeconds: 5 },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
    assert.ok(clock.value >= 5000);
  });

  it("applies abort input policy immediately", async () => {
    const backend = new FakeBackend();
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "approval",
        message: "Approve release?",
        fetchedAt: 0
      }
    ];
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: backend.stoppedBuilds.length === 0,
      result: backend.stoppedBuilds.length === 0 ? undefined : "ABORTED",
      actions: singleTriggerActions
    });

    const result = await immediateRunner(backend).run(
      { ...baseRequest, inputStepPolicy: "abort" },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(backend.stoppedBuilds.length, 1);
  });

  it.each([
    { inputStepPolicy: "abort" as const },
    { inputStepPolicy: "wait" as const, inputTimeoutSeconds: 30 }
  ])("fails and stops the build when input enforcement is unsupported", async (inputOptions) => {
    const backend = new FakeBackend();
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: true,
      actions: singleTriggerActions
    });
    backend.inputSummaries = [
      {
        availability: "unsupported",
        awaitingInput: false,
        count: 0,
        fetchedAt: 0
      }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(
      { ...baseRequest, ...inputOptions },
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.equal(backend.inputCalls, 1);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
    assert.ok(collected.statuses.some((status) => status.includes("cannot be guaranteed")));
  });

  it("resets the timeout for each distinct sequential input gate", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    let stoppedAt: number | undefined;
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "gate-1",
        message: "First gate",
        fetchedAt: 0
      },
      {
        awaitingInput: true,
        count: 1,
        signature: "gate-2",
        message: "Second gate",
        fetchedAt: 5000
      }
    ];
    backend.stopBuild = async (_environment, buildUrl) => {
      stoppedAt = clock.value;
      backend.stoppedBuilds.push(buildUrl);
    };
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: stoppedAt === undefined,
      result: stoppedAt === undefined ? undefined : "ABORTED",
      actions: singleTriggerActions
    });

    const result = await immediateRunner(backend, { clock }).run(
      { ...baseRequest, inputTimeoutSeconds: 6 },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(stoppedAt, 15_000);
  });

  it("does not reset an older input timer when a concurrent gate appears", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    let stoppedAt: number | undefined;
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "aggregate-a",
        inputs: [{ signature: "gate-a", message: "First gate" }],
        fetchedAt: 0
      },
      {
        awaitingInput: true,
        count: 2,
        signature: "aggregate-a-b",
        inputs: [
          { signature: "gate-a", message: "First gate" },
          { signature: "gate-b", message: "Second gate" }
        ],
        fetchedAt: 5000
      }
    ];
    backend.stopBuild = async (_environment, buildUrl) => {
      stoppedAt = clock.value;
      backend.stoppedBuilds.push(buildUrl);
    };
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: stoppedAt === undefined,
      result: stoppedAt === undefined ? undefined : "ABORTED",
      actions: singleTriggerActions
    });

    const result = await immediateRunner(backend, { clock }).run(
      { ...baseRequest, inputTimeoutSeconds: 6 },
      outputCollector().output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(stoppedAt, 10_000);
  });

  it("does not reset an input timer when metadata changes for the same gate id", async () => {
    const backend = new FakeBackend();
    const clock = { value: 0 };
    let stoppedAt: number | undefined;
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "aggregate-v1",
        inputs: [{ id: "gate-a", signature: "metadata-v1", message: "First message" }],
        fetchedAt: 0
      },
      {
        awaitingInput: true,
        count: 1,
        signature: "aggregate-v2",
        inputs: [{ id: "gate-a", signature: "metadata-v2", message: "Updated message" }],
        fetchedAt: 5000
      }
    ];
    backend.stopBuild = async (_environment, buildUrl) => {
      stoppedAt = clock.value;
      backend.stoppedBuilds.push(buildUrl);
    };
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: stoppedAt === undefined,
      result: stoppedAt === undefined ? undefined : "ABORTED",
      actions: singleTriggerActions
    });
    const collected = outputCollector();

    const result = await immediateRunner(backend, { clock }).run(
      { ...baseRequest, inputTimeoutSeconds: 6 },
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.aborted);
    assert.equal(stoppedAt, 10_000);
    assert.equal(
      collected.statuses.filter((status) => status.startsWith("Jenkins is awaiting input")).length,
      2
    );
  });

  it("returns 130 immediately and cleans up a trigger-to-build race", async () => {
    let resolveTrigger: ((value: { queueLocation?: string }) => void) | undefined;
    const backend = new FakeBackend();
    backend.triggerBuild = async () =>
      new Promise((resolve) => {
        resolveTrigger = resolve;
      });
    backend.queueItems = [{ id: 41, executable: { number: 8 } }];
    const runner = immediateRunner(backend);
    const runPromise = runner.run(baseRequest, outputCollector().output);
    await waitUntil(() => resolveTrigger !== undefined);

    runner.cancel();
    const canceled = await runPromise;

    assert.equal(canceled.exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    assert.equal(backend.stoppedBuilds.length, 0);

    resolveTrigger?.({ queueLocation: "/queue/item/41/" });
    await runner.waitForCleanup();

    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/8/"]);
    runner.cancel();
    assert.equal(backend.stoppedBuilds.length, 1);
  });

  it("does not cancel a queue item that existed before the trigger", async () => {
    const backend = new FakeBackend();
    backend.queuedItemsBeforeTrigger = [{ id: 41 }];
    backend.queueItems = [{ id: 41, why: "waiting" }];
    const collected = outputCollector();
    const runner = new JenkinsTaskRunner(backend, {
      pollIntervalMs: 1000,
      delay: async () => new Promise<void>(() => undefined)
    });
    const runPromise = runner.run(baseRequest, collected.output);
    await waitUntil(() => backend.queueCalls > 0);

    runner.cancel();
    assert.equal((await runPromise).exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    await runner.waitForCleanup();

    assert.deepEqual(backend.cancelQueueCalls, []);
    assert.deepEqual(backend.stoppedBuilds, []);
    assert.equal(collected.cleanupErrors.length, 1);
    assert.match(collected.cleanupErrors[0] ?? "", /cleanup was skipped/);
  });

  it("does not stop a build joined by another trigger after the queue snapshot", async () => {
    const backend = new FakeBackend();
    backend.getBuildDetails = async () => ({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: true,
      actions: [{ causes: [{}, {}] }]
    });
    backend.inputSummaries = [
      {
        awaitingInput: true,
        count: 1,
        signature: "approval",
        message: "Approve?",
        fetchedAt: 0
      }
    ];
    const collected = outputCollector();

    const result = await immediateRunner(backend).run(
      { ...baseRequest, inputStepPolicy: "abort" },
      collected.output
    );

    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.error);
    assert.deepEqual(backend.stoppedBuilds, []);
    assert.match(result.error ?? "", /could not verify that the build has a single trigger/);
    assert.equal(collected.cleanupErrors.length, 1);
  });

  it("reports an uncleanable canceled trigger that omitted queue attribution", async () => {
    let resolveTrigger: ((value: { queueLocation?: string }) => void) | undefined;
    const backend = new FakeBackend();
    backend.triggerBuild = async () =>
      new Promise((resolve) => {
        resolveTrigger = resolve;
      });
    const collected = outputCollector();
    const runner = immediateRunner(backend);
    const runPromise = runner.run(baseRequest, collected.output);
    await waitUntil(() => resolveTrigger !== undefined);

    runner.cancel();
    assert.equal((await runPromise).exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    resolveTrigger?.({});
    await runner.waitForCleanup();

    assert.equal(collected.cleanupErrors.length, 1);
    assert.match(collected.cleanupErrors[0], /may still be active/);
  });

  it("does not cancel an attributed item while it remains queued", async () => {
    const backend = new FakeBackend();
    backend.queueItems = [{ id: 41, why: "waiting" }];
    const collected = outputCollector();
    const runner = new JenkinsTaskRunner(backend, {
      pollIntervalMs: 1000,
      delay: async () => new Promise<void>(() => undefined)
    });
    const runPromise = runner.run(baseRequest, collected.output);
    await waitUntil(() => backend.queueCalls > 0);

    runner.cancel();
    const result = await runPromise;
    assert.equal(result.exitCode, JENKINS_TASK_EXIT_CODES.canceled);

    await runner.waitForCleanup();
    assert.deepEqual(backend.cancelQueueCalls, []);
    assert.deepEqual(backend.stoppedBuilds, []);
    assert.equal(collected.cleanupErrors.length, 1);
  });

  it("stops a known running build on cancellation", async () => {
    const backend = new FakeBackend();
    let resolveBuild: ((details: JenkinsTaskBuildDetails) => void) | undefined;
    let buildCalls = 0;
    backend.getBuildDetails = async () => {
      buildCalls++;
      if (buildCalls === 1) {
        return new Promise((resolve) => {
          resolveBuild = resolve;
        });
      }
      return {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true,
        actions: singleTriggerActions
      };
    };
    const runner = immediateRunner(backend);
    const runPromise = runner.run(baseRequest, outputCollector().output);
    await waitUntil(() => resolveBuild !== undefined);

    runner.cancel();
    assert.equal((await runPromise).exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    await waitUntil(() => backend.stoppedBuilds.length > 0);
    resolveBuild?.({
      number: 7,
      url: "https://jenkins.example/job/example/7/",
      building: true,
      actions: singleTriggerActions
    });
    await runner.waitForCleanup();

    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/7/"]);
    assert.equal(backend.progressiveCalls, 0);
    assert.equal(backend.inputCalls, 0);
    assert.equal(runner.state, "canceled");
  });

  it("does not poll input or complete after cancellation during console retrieval", async () => {
    const backend = new FakeBackend();
    let resolveConsole: ((result: JenkinsTaskProgressiveConsoleResult) => void) | undefined;
    backend.buildDetails = [
      {
        number: 7,
        url: "https://jenkins.example/job/example/7/",
        building: true
      }
    ];
    backend.getConsoleTextProgressive = async () => {
      backend.progressiveCalls++;
      return new Promise((resolve) => {
        resolveConsole = resolve;
      });
    };
    const runner = immediateRunner(backend);
    const runPromise = runner.run(baseRequest, outputCollector().output);
    await waitUntil(() => resolveConsole !== undefined);

    runner.cancel();
    assert.equal((await runPromise).exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    resolveConsole?.({ text: "late output\n", textSize: 12, moreData: false, bytesRead: 12 });
    await runner.waitForCleanup();

    assert.equal(backend.inputCalls, 0);
    assert.equal(runner.state, "canceled");
  });

  it("stops a verified executable that appears during queued-task cleanup", async () => {
    const backend = new FakeBackend();
    backend.queueItems = [
      { id: 41, why: "waiting" },
      { id: 41, executable: { number: 9 } }
    ];
    const runner = new JenkinsTaskRunner(backend, {
      pollIntervalMs: 1000,
      delay: async () => new Promise<void>(() => undefined)
    });
    const runPromise = runner.run(baseRequest, outputCollector().output);
    await waitUntil(() => backend.queueCalls > 0);

    runner.cancel();
    assert.equal((await runPromise).exitCode, JENKINS_TASK_EXIT_CODES.canceled);
    await runner.waitForCleanup();

    assert.deepEqual(backend.cancelQueueCalls, []);
    assert.deepEqual(backend.stoppedBuilds, ["https://jenkins.example/job/example/9/"]);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Condition was not reached.");
}
