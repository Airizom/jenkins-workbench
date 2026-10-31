import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { BuildTreeItem } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

const warning = vi.fn(async (_message: string, ..._actions: string[]) => undefined as unknown);
const openExternal = vi.fn(async () => true);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  env: { openExternal },
  window: { showWarningMessage: warning }
}));

const { BuildStopEscalation } = await import("../src/commands/bulk/BuildStopEscalation");
const { BuildTreeItem: BuildTreeItemClass } = await import("../src/tree/TreeItems");

const PIPELINE = "org.jenkinsci.plugins.workflow.job.WorkflowRun";
const FREESTYLE = "hudson.model.FreeStyleBuild";

const environment: JenkinsEnvironmentRef = {
  environmentId: "one",
  name: "First Jenkins",
  scope: "workspace",
  url: "https://ci.example/"
};

function build(number: number, env = environment): BuildTreeItem {
  return Object.assign(Object.create(BuildTreeItemClass.prototype), {
    environment: env,
    buildUrl: `${env.url}job/demo/${number}/`,
    buildNumber: number,
    isBuilding: true,
    jobNameHint: "demo",
    label: `#${number}`
  }) as BuildTreeItem;
}

type State = { className?: string; building: boolean };

function harness(states: Record<number, State | Error | (State | Error)[]>) {
  const reads = new Map<number, number>();
  const getBuildStopState = vi.fn(async (_environment: unknown, url: string) => {
    const number = Number(url.match(/\/(\d+)\/$/)?.[1]);
    const configured = states[number];
    const count = reads.get(number) ?? 0;
    reads.set(number, count + 1);
    const value = Array.isArray(configured)
      ? configured[Math.min(count, configured.length - 1)]
      : configured;
    if (value instanceof Error) {
      throw value;
    }
    return value;
  });
  const runAction = vi.fn(async () => {});
  const logged: string[] = [];
  const showLog = vi.fn();
  const refreshHost = { fullEnvironmentRefresh: vi.fn(() => ({ executed: true })) };
  const escalation = new BuildStopEscalation({
    dataService: { getBuildStopState } as never,
    refreshHost: refreshHost as never,
    runAction,
    log: (lines) => logged.push(...lines),
    showLog
  });
  return { escalation, getBuildStopState, runAction, logged, showLog, refreshHost };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  warning.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

async function settle(promise: Promise<void>): Promise<void> {
  await vi.runAllTimersAsync();
  await promise;
}

describe("BuildStopEscalation", () => {
  it("stays quiet and refreshes once when stopped builds finish within the window", async () => {
    const h = harness({
      1: [
        { className: PIPELINE, building: true },
        { className: PIPELINE, building: false }
      ],
      2: { className: PIPELINE, building: false }
    });
    const running = h.escalation.followUp("stop", [build(1), build(2)]);
    await vi.advanceTimersByTimeAsync(2999);
    assert.equal(h.getBuildStopState.mock.calls.length, 0);
    await settle(running);
    assert.equal(h.getBuildStopState.mock.calls.length, 3);
    assert.equal(warning.mock.calls.length, 0);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it("polls every 3 seconds for 15 seconds, then offers Terminate for all running Pipelines", async () => {
    const h = harness({
      1: { className: PIPELINE, building: true },
      2: { className: PIPELINE, building: true }
    });
    warning.mockResolvedValue("Terminate");
    await settle(h.escalation.followUp("stop", [build(1), build(2)]));
    assert.equal(h.getBuildStopState.mock.calls.length, 10);
    assert.equal(warning.mock.calls.length, 1);
    const [message, ...actions] = warning.mock.calls[0];
    assert.equal(message, "2 build(s) still running after Stop.");
    assert.deepEqual(actions, ["Terminate", "Show Details"]);
    assert.equal(h.runAction.mock.calls.length, 1);
    const [action, items, options] = h.runAction.mock.calls[0] as unknown as [
      string,
      BuildTreeItem[],
      { confirmed?: boolean }
    ];
    assert.equal(action, "terminate");
    assert.deepEqual(
      items.map((item) => item.buildNumber),
      [1, 2]
    );
    assert.deepEqual(options, { confirmed: true });
  });

  it("offers Kill after Terminate without pre-confirming it", async () => {
    const h = harness({ 1: { className: PIPELINE, building: true } });
    warning.mockResolvedValue("Kill…");
    await settle(h.escalation.followUp("terminate", [build(1)]));
    const [message, ...actions] = warning.mock.calls[0];
    assert.equal(message, "1 build(s) still running after Terminate.");
    assert.deepEqual(actions, ["Kill…", "Show Details", "Open in Jenkins"]);
    assert.deepEqual(h.runAction.mock.calls[0], ["kill", [build(1)], {}]);
  });

  it("reports non-Pipeline builds without offering a stronger stop", async () => {
    const h = harness({ 1: { className: FREESTYLE, building: true } });
    warning.mockResolvedValue("Open in Jenkins");
    await settle(h.escalation.followUp("stop", [build(1)]));
    const [message, ...actions] = warning.mock.calls[0];
    assert.match(message, /not Pipeline runs; Jenkins offers no stronger stop/);
    assert.deepEqual(actions, ["Show Details", "Open in Jenkins"]);
    assert.match(
      h.logged.join("\n"),
      /not a Pipeline run .*demo #1 \(https:\/\/ci\.example\/job\/demo\/1\/\)/
    );
    assert.equal(h.runAction.mock.calls.length, 0);
    assert.equal(openExternal.mock.calls.length, 1);
  });

  it("escalates only the Pipeline builds of a mixed selection", async () => {
    const h = harness({
      1: { className: PIPELINE, building: true },
      2: { className: FREESTYLE, building: true },
      3: { className: PIPELINE, building: false }
    });
    warning.mockResolvedValue("Terminate");
    await settle(h.escalation.followUp("stop", [build(1), build(2), build(3)]));
    const [message] = warning.mock.calls[0];
    assert.match(
      message,
      /^2 build\(s\) still running after Stop\. 1 of them are not Pipeline runs/
    );
    const items = (h.runAction.mock.calls[0] as unknown as [string, BuildTreeItem[]])[1];
    assert.deepEqual(
      items.map((item) => item.buildNumber),
      [1]
    );
    // Build #3 finished during the window, so the tree is refreshed before prompting.
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it("keeps builds whose state cannot be read and leaves the class check to Terminate", async () => {
    const h = harness({ 1: new Error("network down") });
    warning.mockResolvedValue("Show Details");
    await settle(h.escalation.followUp("stop", [build(1)]));
    const [, ...actions] = warning.mock.calls[0];
    assert.equal(actions[0], "Terminate");
    assert.match(h.logged.join("\n"), /type unknown/);
    assert.equal(h.showLog.mock.calls.length, 1);
    assert.equal(h.runAction.mock.calls.length, 0);
  });

  it("reads at most three builds at a time", async () => {
    let active = 0;
    let maximum = 0;
    const h = harness({});
    h.getBuildStopState.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return { className: PIPELINE, building: false };
    });
    await settle(
      h.escalation.followUp(
        "stop",
        [1, 2, 3, 4, 5, 6].map((n) => build(n))
      )
    );
    assert.equal(maximum, 3);
    assert.equal(h.getBuildStopState.mock.calls.length, 6);
  });

  it("hands a build to the newest follow-up so it is prompted only once", async () => {
    const h = harness({ 1: { className: PIPELINE, building: true } });
    warning.mockResolvedValue(undefined);
    const older = h.escalation.followUp("stop", [build(1)]);
    await vi.advanceTimersByTimeAsync(6000);
    const newer = h.escalation.followUp("terminate", [build(1)]);
    await settle(Promise.all([older, newer]).then(() => {}));
    assert.equal(warning.mock.calls.length, 1);
    assert.match(String(warning.mock.calls[0][0]), /after Terminate/);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
  });

  it("ignores a stale prompt choice for a build a newer follow-up took over", async () => {
    const h = harness({ 1: { className: PIPELINE, building: true } });
    let choose: ((value: unknown) => void) | undefined;
    warning.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          choose = resolve;
        })
    );
    const older = h.escalation.followUp("stop", [build(1)]);
    await vi.advanceTimersByTimeAsync(15000);
    assert.ok(choose);
    const newer = h.escalation.followUp("terminate", [build(1)]);
    choose?.("Terminate");
    await settle(Promise.all([older, newer]).then(() => {}));
    assert.equal(h.runAction.mock.calls.length, 0);
  });

  it("stops polling and never prompts after disposal", async () => {
    const h = harness({ 1: { className: PIPELINE, building: true } });
    const running = h.escalation.followUp("stop", [build(1)]);
    await vi.advanceTimersByTimeAsync(3000);
    assert.equal(h.getBuildStopState.mock.calls.length, 1);
    h.escalation.dispose();
    await settle(running);
    assert.equal(h.getBuildStopState.mock.calls.length, 1);
    assert.equal(warning.mock.calls.length, 0);
    assert.equal(vi.getTimerCount(), 0);
    await h.escalation.followUp("stop", [build(2)]);
    assert.equal(h.getBuildStopState.mock.calls.length, 1);
  });
});
