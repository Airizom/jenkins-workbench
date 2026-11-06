import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { JenkinsQueueItemInfo } from "../src/jenkins/data/JenkinsDataTypes";
import type { JenkinsIndexingLog } from "../src/jenkins/JenkinsIndexingTypes";
import type { JenkinsQueueItem, ScanMultibranchResult } from "../src/jenkins/types";
import { MultibranchScanService } from "../src/services/multibranchScan/MultibranchScanService";
import {
  formatMultibranchScanStatus,
  multibranchScanKey,
  type MultibranchScanState,
  MultibranchScanStateStore,
  type MultibranchScanTarget
} from "../src/services/multibranchScan/MultibranchScanState";

const target: MultibranchScanTarget = {
  environment: { environmentId: "env", scope: "workspace", url: "https://jenkins.example/" },
  folderUrl: "https://jenkins.example/job/app/",
  label: "app"
};

function log(text: string, moreData: boolean | undefined = false): JenkinsIndexingLog {
  return {
    text,
    textSize: Buffer.byteLength(text),
    moreData,
    prefix: text.slice(0, 4096),
    fingerprint: text,
    truncated: false,
    source: moreData === undefined ? "snapshot" : "progressive"
  };
}

function queue(id = 7): JenkinsQueueItemInfo {
  return {
    id,
    name: "app",
    position: 1,
    taskUrl: target.folderUrl,
    reason: "Waiting for an executor"
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness(options: ConstructorParameters<typeof MultibranchScanService>[2] = {}) {
  const data = {
    getQueueItems: vi.fn(async (): Promise<JenkinsQueueItemInfo[]> => []),
    getQueueItem: vi.fn(async (): Promise<JenkinsQueueItem> => {
      throw new Error("Not found");
    }),
    scanMultibranch: vi.fn(async (): Promise<ScanMultibranchResult> => ({})),
    getMultibranchScanLog: vi.fn(async () => log("old\nFinished: SUCCESS\n"))
  };
  const store = new MultibranchScanStateStore();
  const service = new MultibranchScanService(data, store, options);
  const completed: MultibranchScanState[] = [];
  service.onDidComplete((state) => completed.push(state));
  cleanup.push(() => {
    service.dispose();
    store.dispose();
  });
  return { data, store, service, completed };
}

const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose();
  }
  vi.useRealTimers();
});

describe("MultibranchScanService", () => {
  it("tracks requested, queued, running, and completed exactly once", async () => {
    const { data, store, service, completed } = harness();
    assert.equal((await service.request(target)).phase, "requested");
    data.getQueueItems.mockResolvedValue([queue()]);
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.phase, "queued");
    assert.equal(store.get(target)?.detail, "Waiting for an executor");
    data.getQueueItems.mockResolvedValue([]);
    data.getMultibranchScanLog.mockResolvedValue(log("new scan\n", true));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.phase, "running");
    data.getMultibranchScanLog.mockResolvedValue(log("new scan\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.outcome, "success");
    assert.equal(completed.length, 1);
    const calls = data.getMultibranchScanLog.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(data.getMultibranchScanLog.mock.calls.length, calls);
    assert.equal(data.scanMultibranch.mock.calls.length, 1);
  });

  it.each([
    ["FAILURE", "failure"],
    ["ABORTED", "aborted"],
    ["UNSTABLE", "failure"],
    ["NOT_BUILT", "failure"],
    ["", "unknown"]
  ])("reports %s only after completion", async (result, expected) => {
    const { data, service, store, completed } = harness();
    await service.request(target);
    data.getMultibranchScanLog.mockResolvedValue(log(`new\nFinished: ${result}\n`));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.outcome, expected);
    assert.equal(completed.length, 1);
  });

  it("accepts a new completed log when the running interval was missed", async () => {
    const { data, service, completed } = harness();
    await service.request(target);
    data.getMultibranchScanLog.mockResolvedValue(log("new scan\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(completed.length, 1);
  });

  it("does not treat the previous success as a new scan, including after a queue entry expires", async () => {
    const { data, service, store, completed } = harness();
    data.scanMultibranch.mockResolvedValue({ queueLocation: "/queue/item/7/" });
    await service.request(target);
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(store.get(target)?.phase, "unavailable");
    assert.match(store.get(target)?.detail ?? "", /previous indexing log/);
    assert.equal(completed.length, 0);
    assert.ok(data.getQueueItem.mock.calls.length > 0);
  });

  it.each([undefined, "/queue/item/7/", "https://jenkins.example/queue/item/7/", "/job/app/"])(
    "handles submission Location %s",
    async (queueLocation) => {
      const { data, service } = harness();
      data.scanMultibranch.mockResolvedValue({ queueLocation });
      const state = await service.request(target);
      assert.equal(state.phase, queueLocation?.includes("queue/item") ? "queued" : "requested");
    }
  );

  it("does not mark an empty log with moreData=true as running", async () => {
    const { data, service, store } = harness({ evidenceTimeoutMs: 4000 });
    data.getMultibranchScanLog.mockResolvedValue(log("", true));
    await service.request(target);
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.phase, "requested");
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.phase, "unavailable");
  });

  it("coalesces simultaneous commands and follows the current state on repeat", async () => {
    const { data, service } = harness();
    const result = deferred<ScanMultibranchResult>();
    data.scanMultibranch.mockReturnValue(result.promise);
    const first = service.request(target);
    const second = service.request(target);
    const opened = service.attach(target);
    result.resolve({});
    await Promise.all([first, second, opened]);
    assert.equal(data.scanMultibranch.mock.calls.length, 1);
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal((await service.request(target)).phase, "running");
    assert.equal(data.scanMultibranch.mock.calls.length, 1);
  });

  it("honors concurrent scan commands arriving during a historical-log attachment", async () => {
    const { data, service } = harness();
    const pending = deferred<JenkinsIndexingLog>();
    data.getMultibranchScanLog.mockReturnValueOnce(pending.promise);
    const attachment = service.attach(target);
    const firstRequest = service.request(target);
    const secondRequest = service.request(target);
    pending.resolve(log("old\nFinished: SUCCESS\n"));
    const [attached, first, second] = await Promise.all([attachment, firstRequest, secondRequest]);
    assert.equal(attached.phase, "completed");
    assert.equal(first.phase, "requested");
    assert.equal(second.phase, "requested");
    assert.equal(data.scanMultibranch.mock.calls.length, 1);
  });

  it("still follows an active scan found by an attachment with concurrent scan commands", async () => {
    const { data, service } = harness();
    const pending = deferred<JenkinsIndexingLog>();
    data.getMultibranchScanLog.mockReturnValueOnce(pending.promise);
    const attachment = service.attach(target);
    const requested = service.request(target);
    pending.resolve(log("running\n", true));
    const states = await Promise.all([attachment, requested]);
    assert.deepEqual(
      states.map((state) => state.phase),
      ["running", "running"]
    );
    assert.equal(data.scanMultibranch.mock.calls.length, 0);
  });

  it.each(["environment change", "disposal"])(
    "does not restart an attachment's deferred scan command after %s",
    async (reason) => {
      const { data, service, store } = harness();
      const pending = deferred<JenkinsIndexingLog>();
      data.getMultibranchScanLog.mockReturnValueOnce(pending.promise);
      const attachment = service.attach(target);
      const requested = service.request(target);
      if (reason === "disposal") {
        service.dispose();
      } else {
        service.stopEnvironment(target.environment.environmentId, "Environment changed.");
      }
      pending.resolve(log("old\nFinished: SUCCESS\n"));
      const results = await Promise.all([attachment, requested]);
      assert.deepEqual(
        results.map((state) => state.phase),
        ["unavailable", "unavailable"]
      );
      assert.equal(data.scanMultibranch.mock.calls.length, 0);
      assert.equal(data.getMultibranchScanLog.mock.calls.length, 1);
      assert.equal(store.get(target)?.phase, "unavailable");
      assert.equal((Reflect.get(service, "sessions") as Map<string, unknown>).size, 0);
    }
  );

  it("does not claim a new scan when fallback and progressive samples of the old log differ", async () => {
    const { data, service, store, completed } = harness({ evidenceTimeoutMs: 6000 });
    data.getMultibranchScanLog.mockResolvedValueOnce({
      ...log("old\nFinished: SUCCESS\n", undefined),
      source: "snapshot",
      moreData: undefined,
      textSize: 30,
      prefix: "old\n",
      fingerprint: "fallback old log"
    });
    await service.request(target);
    data.getMultibranchScanLog.mockResolvedValue({
      ...log("old\r\nFinished: SUCCESS\r\n"),
      prefix: "old\r\n",
      fingerprint: "progressive old log"
    });
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.phase, "requested");
    assert.equal(store.get(target)?.logRevision, 0);
    assert.equal(completed.length, 0);
    await vi.advanceTimersByTimeAsync(4000);
    assert.equal(store.get(target)?.phase, "unavailable");
    assert.equal(completed.length, 0);
  });

  it("accepts independently observed running evidence across log transport changes", async () => {
    const { data, service, completed } = harness();
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    await service.attach(target);
    data.getMultibranchScanLog.mockResolvedValue({
      ...log("running\nFinished: SUCCESS\n"),
      source: "snapshot",
      moreData: undefined
    });
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(completed.length, 0);
    data.getMultibranchScanLog.mockResolvedValue(log("running\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(4000);
    assert.equal(completed.length, 1);
  });

  it.each(["queued", "running"])(
    "follows an externally %s scan without submitting",
    async (phase) => {
      const { data, service, completed } = harness();
      if (phase === "queued") {
        data.getQueueItems.mockResolvedValue([queue()]);
      } else {
        data.getMultibranchScanLog.mockResolvedValue(log("active\n", true));
      }
      assert.equal((await service.request(target)).phase, phase);
      assert.equal(data.scanMultibranch.mock.calls.length, 0);
      data.getQueueItems.mockResolvedValue([]);
      data.getMultibranchScanLog.mockResolvedValue(log("active\nFinished: FAILURE\n"));
      await vi.advanceTimersByTimeAsync(2000);
      assert.equal(completed.length, 1);
      assert.equal(completed[0].outcome, "failure");
    }
  );

  it("opens a historical completed scan without notification", async () => {
    const { service, completed, data } = harness();
    assert.equal((await service.attach(target)).phase, "completed");
    assert.equal(completed.length, 0);
    assert.equal(data.scanMultibranch.mock.calls.length, 0);
  });

  it("recovers an initial log request failure to a historical result without notification", async () => {
    const { service, completed, data, store } = harness();
    data.getMultibranchScanLog.mockRejectedValueOnce(new Error("Connection reset"));
    await service.attach(target);
    await vi.advanceTimersByTimeAsync(4000);
    assert.equal(store.get(target)?.phase, "completed");
    assert.equal(store.get(target)?.outcome, "success");
    assert.equal(completed.length, 0);
    assert.equal(data.scanMultibranch.mock.calls.length, 0);
  });

  it("does not mistake an attached queue's old completed log for the queued scan after recovery", async () => {
    const { service, completed, data, store } = harness({ evidenceTimeoutMs: 8000 });
    data.getQueueItems.mockResolvedValueOnce([queue()]);
    await service.attach(target);
    data.getMultibranchScanLog.mockRejectedValueOnce(new Error("Connection reset"));
    await vi.advanceTimersByTimeAsync(8000);
    assert.equal(store.get(target)?.phase, "unavailable");
    assert.equal(completed.length, 0);
  });

  it("tracks a running external scan attached through its log", async () => {
    const { service, data, completed } = harness();
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    await service.attach(target);
    data.getMultibranchScanLog.mockResolvedValue(log("running\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(completed.length, 1);
  });

  it("keeps queued status while log fetching fails and permits recovery", async () => {
    const { service, data, store, completed } = harness();
    await service.request(target);
    data.getQueueItems.mockResolvedValue([queue()]);
    data.getMultibranchScanLog.mockRejectedValue(new Error("Forbidden"));
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(store.get(target)?.phase, "queued");
    assert.equal(store.get(target)?.logError, "Forbidden");
    assert.equal(completed.length, 0);
    data.getQueueItems.mockResolvedValue([]);
    data.getMultibranchScanLog.mockResolvedValue(log("new\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(completed.length, 1);
  });

  it("stops after five tracking failures, preserving logs, and attach recovers", async () => {
    const { service, data, store, completed } = harness({ evidenceTimeoutMs: 300_000 });
    await service.request(target);
    data.getMultibranchScanLog.mockRejectedValue(new Error("Authentication required"));
    await vi.advanceTimersByTimeAsync(100_000);
    assert.equal(store.get(target)?.phase, "unavailable");
    assert.match(store.get(target)?.detail ?? "", /Authentication required/);
    assert.match(store.get(target)?.log?.text ?? "", /old/);
    assert.equal(data.getMultibranchScanLog.mock.calls.length, 6);
    assert.equal(completed.length, 0);
    data.getMultibranchScanLog.mockResolvedValue(log("new running\n", true));
    assert.equal((await service.attach(target)).phase, "running");
  });

  it("does not impose an evidence deadline on a known queued or running scan", async () => {
    const { service, data, store } = harness({ evidenceTimeoutMs: 4000 });
    data.getQueueItems.mockResolvedValue([queue()]);
    await service.request(target);
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(store.get(target)?.phase, "queued");
    data.getQueueItems.mockResolvedValue([]);
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(store.get(target)?.phase, "running");
  });

  it("reports a cancelled queue item as aborted, never successful", async () => {
    const { service, data, completed } = harness();
    data.scanMultibranch.mockResolvedValue({ queueLocation: "/queue/item/7/" });
    data.getQueueItem.mockResolvedValue({ id: 7, cancelled: true });
    await service.request(target);
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(completed[0]?.outcome, "aborted");
  });

  it("distinguishes submission failures and permits a later retry", async () => {
    const { service, data, store } = harness();
    data.scanMultibranch.mockRejectedValueOnce(new Error("Build permission denied"));
    await assert.rejects(service.request(target), /permission denied/);
    assert.match(store.get(target)?.detail ?? "", /submission failed/);
    await service.request(target);
    assert.equal(data.scanMultibranch.mock.calls.length, 2);
  });

  it("increments the log revision on replacement without concatenating scans", async () => {
    const { service, data, store } = harness();
    data.getMultibranchScanLog.mockResolvedValue(log("first running scan\n", true));
    await service.attach(target);
    data.getMultibranchScanLog.mockResolvedValue(log("second scan\n", true));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.logRevision, 1);
    assert.equal(store.get(target)?.log?.text, "second scan\n");
    assert.match(store.get(target)?.detail ?? "", /replaced/);
  });

  it("does not treat naturally growing prefixes as log replacement", async () => {
    const { service, data, store } = harness();
    data.getMultibranchScanLog.mockResolvedValue(log("first\n", true));
    await service.attach(target);
    data.getMultibranchScanLog.mockResolvedValue(log("first\nsecond\n", true));
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(store.get(target)?.logRevision, 0);
  });

  it("ignores in-flight results after environment removal and stops polling", async () => {
    const { service, data, store, completed } = harness();
    await service.request(target);
    const pending = deferred<JenkinsIndexingLog>();
    data.getMultibranchScanLog.mockReturnValue(pending.promise);
    await vi.advanceTimersByTimeAsync(2000);
    service.stopEnvironment("env", "Environment removed.");
    pending.resolve(log("new\nFinished: SUCCESS\n"));
    await vi.advanceTimersByTimeAsync(20_000);
    assert.equal(store.get(target)?.phase, "unavailable");
    assert.equal(store.get(target)?.detail, "Environment removed.");
    assert.equal(completed.length, 0);
  });

  it("does not submit when disposed during preflight", async () => {
    const { service, data } = harness();
    const pending = deferred<JenkinsIndexingLog>();
    data.getMultibranchScanLog.mockReturnValue(pending.promise);
    const request = service.request(target);
    service.dispose();
    pending.resolve(log("old"));
    await request;
    assert.equal(data.scanMultibranch.mock.calls.length, 0);
    await assert.rejects(service.attach(target), /stopped/);
  });

  it("releases stopped sessions while retaining their final tree state", async () => {
    const { service, store, data } = harness();
    await service.attach(target);
    assert.equal((Reflect.get(service, "sessions") as Map<string, unknown>).size, 0);
    assert.equal(store.get(target)?.phase, "completed");
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    await service.attach(target);
    assert.equal((Reflect.get(service, "sessions") as Map<string, unknown>).size, 1);
    service.stopEnvironment(target.environment.environmentId, "Environment changed.");
    assert.equal((Reflect.get(service, "sessions") as Map<string, unknown>).size, 0);
    assert.equal(store.get(target)?.phase, "unavailable");
  });

  it("disposes every active session when stopping removes map entries", async () => {
    const { service, store, data } = harness();
    data.getMultibranchScanLog.mockResolvedValue(log("running\n", true));
    const targets = Array.from({ length: 5 }, (_, index) => ({
      ...target,
      folderUrl: `${target.folderUrl}${index}/`
    }));
    await Promise.all(targets.map((item) => service.attach(item)));
    service.dispose();
    for (const item of targets) {
      assert.equal(store.get(item)?.phase, "unavailable");
      assert.equal(store.get(item)?.detail, "Scan tracking stopped.");
    }
    assert.equal((Reflect.get(service, "sessions") as Map<string, unknown>).size, 0);
    const calls = data.getMultibranchScanLog.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    assert.equal(data.getMultibranchScanLog.mock.calls.length, calls);
  });

  it("shares queue requests across folders and keeps environment scopes isolated", async () => {
    const { service, data } = harness();
    const second = { ...target, folderUrl: "https://jenkins.example/job/other/" };
    await Promise.all([service.attach(target), service.attach(second)]);
    assert.equal(data.getQueueItems.mock.calls.length, 1);
    await service.attach({ ...target, environment: { ...target.environment, scope: "global" } });
    assert.equal(data.getQueueItems.mock.calls.length, 2);
  });

  it("bounds request concurrency across folders", async () => {
    const { service, data } = harness({ maxConcurrency: 2 });
    let active = 0;
    let peak = 0;
    const pending: Array<ReturnType<typeof deferred<JenkinsIndexingLog>>> = [];
    data.getMultibranchScanLog.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      const item = deferred<JenkinsIndexingLog>();
      pending.push(item);
      const result = await item.promise;
      active -= 1;
      return result;
    });
    const requests = Array.from({ length: 8 }, (_, i) =>
      service.attach({ ...target, folderUrl: `${target.folderUrl}${i}/` })
    );
    for (let i = 0; i < 8; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      pending[i]?.resolve(log("Finished: SUCCESS\n"));
    }
    await Promise.all(requests);
    assert.ok(peak <= 2);
  });

  it("strips console notes before reading the terminal outcome", async () => {
    const { service, data, store } = harness();
    data.getMultibranchScanLog.mockResolvedValue(
      log("new\n\u001b[8mha:serialized\u001b[0mFinished: SUCCESS\n")
    );
    await service.attach(target);
    assert.equal(store.get(target)?.outcome, "success");
  });
});

describe("MultibranchScanStateStore", () => {
  it("retains the latest 50 terminal logs, preserving older status metadata without editor reset events", () => {
    const store = new MultibranchScanStateStore();
    const changes: MultibranchScanState[] = [];
    store.onDidChange((state) => changes.push(state));
    const targets = Array.from({ length: 52 }, (_, index) => ({
      ...target,
      folderUrl: `${target.folderUrl}${index}/`
    }));
    for (const item of targets) {
      store.set({
        target: item,
        phase: "completed",
        outcome: "success",
        generation: 1,
        observedAt: 1,
        logRevision: 0,
        log: log("Finished: SUCCESS\n")
      });
    }
    for (const item of targets.slice(0, 2)) {
      assert.equal(store.get(item)?.phase, "completed");
      assert.equal(store.get(item)?.outcome, "success");
      assert.equal(store.get(item)?.log, undefined);
    }
    assert.equal(targets.filter((item) => store.get(item)?.log).length, 50);
    assert.equal(changes.length, 52);
    store.dispose();
    assert.equal(store.get(targets[51]), undefined);
  });

  it("normalizes folder URLs and formats every phase", () => {
    assert.equal(
      multibranchScanKey(target),
      multibranchScanKey({ ...target, folderUrl: "https://jenkins.example/job/app?x=1" })
    );
    const state: MultibranchScanState = {
      target,
      phase: "requested",
      observedAt: 0,
      generation: 1,
      logRevision: 0
    };
    for (const phase of ["requested", "queued", "running", "unavailable", "completed"] as const) {
      assert.match(formatMultibranchScanStatus({ ...state, phase }), /Scan/);
    }
    for (const outcome of ["success", "failure", "aborted", "unknown"] as const) {
      assert.match(
        formatMultibranchScanStatus({ ...state, phase: "completed", outcome }),
        new RegExp(outcome)
      );
    }
  });
});
