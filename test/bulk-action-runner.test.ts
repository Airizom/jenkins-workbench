import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { WorkbenchTreeElement } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

const lines: string[] = [];
const token = { isCancellationRequested: false };
const progress = vi.fn();
const show = vi.fn();
const dispose = vi.fn();
const information = vi.fn(
  async (_message: string, ..._choices: unknown[]) => undefined as string | undefined
);
const warning = vi.fn(async (_message: string, options?: unknown, choice?: string) =>
  typeof options === "object" ? choice : undefined
);
const error = vi.fn(
  async (_message: string, ..._choices: unknown[]) => undefined as string | undefined
);
const withProgress = vi.fn(
  async (
    _options: unknown,
    callback: (reporter: { report: typeof progress }, cancellation: typeof token) => Promise<void>
  ) => callback({ report: progress }, token)
);
const createOutputChannel = vi.fn(() => ({
  appendLine: (line: string) => lines.push(line),
  show,
  dispose
}));

vi.doMock("vscode", () => ({
  ...vscodeStub,
  ProgressLocation: { Notification: 15 },
  window: {
    showInformationMessage: information,
    showWarningMessage: warning,
    showErrorMessage: error,
    withProgress,
    createOutputChannel
  }
}));

const { BulkActionService } = await import("../src/commands/bulk/BulkActionService");
const { resolveBulkActionTargets, isBulkActionEligible } = await import(
  "../src/commands/bulk/BulkActionTargets"
);
const { BuildTreeItem, JobTreeItem, QueueItemTreeItem, StalePinnedJobTreeItem } = await import(
  "../src/tree/TreeItems"
);

const environment: JenkinsEnvironmentRef = {
  environmentId: "one",
  name: "First Jenkins",
  scope: "workspace",
  url: "https://ci.example/"
};
function build(
  number: number,
  env = environment,
  url = `${env.url}job/demo/${number}/`
): WorkbenchTreeElement {
  return Object.assign(Object.create(BuildTreeItem.prototype), {
    environment: env,
    buildUrl: url,
    buildNumber: number,
    isBuilding: true,
    label: `#${number}`
  });
}
function job(
  name: string,
  env = environment,
  url = `${env.url}job/${name}/`
): WorkbenchTreeElement {
  return Object.assign(Object.create(JobTreeItem.prototype), {
    environment: env,
    jobUrl: url,
    presentation: "job",
    label: name
  });
}
function queue(id: number, env = environment): WorkbenchTreeElement {
  return Object.assign(Object.create(QueueItemTreeItem.prototype), {
    environment: env,
    queueId: id,
    label: `queued-${id}`
  });
}
function harness() {
  const dataService = {
    stopBuild: vi.fn(async () => {}),
    escalateBuildStop: vi.fn(
      async (_environment: unknown, _url: string, _step: string) =>
        "sent" as "sent" | "not-running" | "unsupported"
    ),
    cancelQueueItem: vi.fn(async () => {})
  };
  const escalation = {
    followUp: vi.fn(async (_stage: string, _items: readonly WorkbenchTreeElement[]) => {}),
    dispose: vi.fn()
  };
  let escalationDependencies:
    | {
        runAction(
          action: string,
          items: readonly WorkbenchTreeElement[],
          options: { confirmed?: boolean }
        ): Promise<void>;
      }
    | undefined;
  const watchStore = {
    isWatched: vi.fn(async () => false),
    addWatch: vi.fn(async () => {}),
    removeWatch: vi.fn(async () => false)
  };
  const pinStore = {
    isPinned: vi.fn(async () => false),
    addPin: vi.fn(async () => {}),
    removePin: vi.fn(async () => false)
  };
  const refreshHost = { fullEnvironmentRefresh: vi.fn(() => ({ executed: true })) };
  const service = new BulkActionService({
    dataService,
    watchStore,
    pinStore,
    refreshHost,
    createStopEscalation: (dependencies: NonNullable<typeof escalationDependencies>) => {
      escalationDependencies = dependencies;
      return escalation;
    }
  } as unknown as ConstructorParameters<typeof BulkActionService>[0]);
  return {
    service,
    dataService,
    watchStore,
    pinStore,
    refreshHost,
    escalation,
    escalationRun: (
      action: string,
      items: readonly WorkbenchTreeElement[],
      options: { confirmed?: boolean } = {}
    ) => escalationDependencies?.runAction(action, items, options)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  lines.length = 0;
  token.isCancellationRequested = false;
  warning.mockImplementation(async (_message, options, choice) =>
    typeof options === "object" ? choice : undefined
  );
  information.mockResolvedValue(undefined);
});

describe("bulk target resolution", () => {
  it("deduplicates canonical resources but keeps environments and scopes distinct", () => {
    const anotherEnvironment = { ...environment, environmentId: "two" };
    const globalEnvironment = { ...environment, scope: "global" as const };
    const completed = Object.assign(build(2), { isBuilding: false });
    const resolution = resolveBulkActionTargets("stop", [
      build(1),
      build(1, environment, "https://legacy.example/view/main/job/demo/1/"),
      build(1, anotherEnvironment),
      build(1, globalEnvironment),
      completed,
      job("demo")
    ]);
    assert.equal(resolution.targets.length, 3);
    assert.equal(resolution.duplicates.length, 1);
    assert.equal(resolution.incompatible.length, 2);
    assert.equal(
      resolveBulkActionTargets("cancel", [queue(7), queue(7), queue(7, anotherEnvironment)]).targets
        .length,
      2
    );
  });

  it("merges every raw alias and permits stale pins only for unpinning", () => {
    const stale = Object.assign(Object.create(StalePinnedJobTreeItem.prototype), {
      environment,
      jobUrl: "https://legacy.example/job/demo/",
      label: "demo"
    }) as WorkbenchTreeElement;
    const resolution = resolveBulkActionTargets("unpin", [
      job("demo"),
      job("demo", environment, "https://ci.example/view/main/job/demo/"),
      stale
    ]);
    assert.equal(resolution.targets.length, 1);
    const target = resolution.targets[0];
    assert.equal(target.kind, "job");
    if (target.kind === "job") {
      assert.deepEqual(target.aliases, [
        "https://ci.example/job/demo/",
        "https://ci.example/view/main/job/demo/",
        "https://legacy.example/job/demo/"
      ]);
    }
    assert.equal(isBulkActionEligible("watch", stale), false);
    assert.equal(isBulkActionEligible("unpin", stale), true);
  });
});

describe("BulkActionService", () => {
  it("does nothing when confirmation is declined and keeps output lazy", async () => {
    const h = harness();
    warning.mockResolvedValueOnce(undefined);
    await h.service.run("stop", [build(1)]);
    assert.equal(warning.mock.calls.length, 1);
    assert.equal(h.dataService.stopBuild.mock.calls.length, 0);
    assert.equal(withProgress.mock.calls.length, 0);
    assert.equal(createOutputChannel.mock.calls.length, 0);
    h.service.dispose();
    assert.equal(dispose.mock.calls.length, 0);
  });

  it("confirms once, bounds the preview, and reports skipped selections", async () => {
    const h = harness();
    const second = { ...environment, environmentId: "two", name: "Second Jenkins" };
    await h.service.run("cancel", [
      ...Array.from({ length: 22 }, (_, index) => queue(index, index === 0 ? second : environment)),
      job("demo"),
      queue(1)
    ]);
    assert.equal(warning.mock.calls.length, 1);
    const options = warning.mock.calls[0][1] as { modal: boolean; detail: string };
    assert.equal(options.modal, true);
    assert.match(options.detail, /Second Jenkins/);
    assert.match(options.detail, /First Jenkins/);
    assert.match(options.detail, /and 2 more/);
    assert.match(options.detail, /2 incompatible or duplicate/);
    assert.equal(h.dataService.cancelQueueItem.mock.calls.length, 22);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 2);
    assert.match(lines.join("\n"), /1 incompatible, 1 duplicate, 22 succeeded/);
  });

  it("limits remote concurrency and continues after failures", async () => {
    const h = harness();
    const releases: (() => void)[] = [];
    let active = 0;
    let maximum = 0;
    let calls = 0;
    h.dataService.stopBuild.mockImplementation(async () => {
      const call = ++calls;
      active++;
      maximum = Math.max(maximum, active);
      if (call <= 3) {
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      active--;
      if (call === 2) {
        throw new Error("permission denied");
      }
    });
    const running = h.service.run(
      "stop",
      Array.from({ length: 5 }, (_, index) => build(index + 1))
    );
    await vi.waitFor(() => assert.equal(releases.length, 3));
    assert.equal(calls, 3);
    releases.forEach((release) => {
      release();
    });
    await running;
    assert.equal(maximum, 3);
    assert.equal(calls, 5);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
    assert.equal(warning.mock.calls.length, 2);
    assert.match(lines.join("\n"), /permission denied/);
    assert.match(lines.join("\n"), /4 succeeded/);
  });

  it("cancels unsent work, awaits in-flight requests, and reports the remainder", async () => {
    const h = harness();
    const releases: (() => void)[] = [];
    h.dataService.stopBuild.mockImplementation(
      async () => new Promise<void>((resolve) => releases.push(resolve))
    );
    const running = h.service.run(
      "stop",
      Array.from({ length: 5 }, (_, index) => build(index))
    );
    await vi.waitFor(() => assert.equal(releases.length, 3));
    token.isCancellationRequested = true;
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
    releases.forEach((release) => {
      release();
    });
    await running;
    assert.equal(h.dataService.stopBuild.mock.calls.length, 3);
    assert.match(lines.join("\n"), /3 succeeded, 2 unattempted/);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
  });

  it("does not refresh unchanged or ineligible targets and offers result details", async () => {
    const h = harness();
    h.watchStore.isWatched.mockResolvedValue(true);
    information.mockResolvedValue("Show Details");
    await h.service.run("watch", [job("demo"), queue(1)]);
    assert.equal(h.watchStore.addWatch.mock.calls.length, 0);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
    assert.equal(show.mock.calls.length, 1);
    assert.match(lines.join("\n"), /unchanged/);
    await h.service.run("pin", [queue(1)]);
    assert.equal(withProgress.mock.calls.length, 1);
    assert.match(lines.join("\n"), /No eligible items selected/);
    h.service.dispose();
    assert.equal(dispose.mock.calls.length, 1);
  });

  it("stores canonical URLs sequentially and checks all aliases", async () => {
    const h = harness();
    const watched = [job("first", environment, "https://legacy.example/job/first/"), job("second")];
    let finishFirst: (() => void) | undefined;
    h.watchStore.addWatch.mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    );
    const running = h.service.run("watch", watched);
    await vi.waitFor(() => assert.equal(h.watchStore.addWatch.mock.calls.length, 1));
    assert.equal(h.watchStore.isWatched.mock.calls.length, 2);
    finishFirst?.();
    await running;
    assert.equal(h.watchStore.isWatched.mock.calls.length, 3);
    assert.equal(h.watchStore.addWatch.mock.calls.length, 2);
    assert.deepEqual((h.watchStore.addWatch.mock.calls as unknown[][])[0], [
      "workspace",
      {
        environmentId: "one",
        jobUrl: "https://ci.example/job/first/",
        jobName: "first",
        jobKind: "job"
      }
    ]);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
    await h.service.run("pin", [job("third")]);
    assert.equal(h.pinStore.addPin.mock.calls.length, 1);
  });

  it("cancels before a store write when cancellation arrives during its state check", async () => {
    const h = harness();
    let finishCheck: ((present: boolean) => void) | undefined;
    h.pinStore.isPinned.mockImplementationOnce(
      async () =>
        new Promise<boolean>((resolve) => {
          finishCheck = resolve;
        })
    );
    const running = h.service.run("pin", [job("first"), job("second")]);
    await vi.waitFor(() => assert.equal(h.pinStore.isPinned.mock.calls.length, 1));
    token.isCancellationRequested = true;
    finishCheck?.(false);
    await running;
    assert.equal(h.pinStore.addPin.mock.calls.length, 0);
    assert.equal(h.pinStore.isPinned.mock.calls.length, 1);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
    assert.match(lines.join("\n"), /2 unattempted/);
  });

  it.each(["unwatch", "unpin"] as const)("does not refresh missing %s state", async (action) => {
    const h = harness();
    await h.service.run(action, [job("missing")]);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
    assert.match(lines.join("\n"), /1 unchanged/);
  });

  it.each(["unwatch", "unpin"] as const)(
    "settles all %s aliases, preserves partial changes, and continues",
    async (action) => {
      const h = harness();
      const remove = action === "unwatch" ? h.watchStore.removeWatch : h.pinStore.removePin;
      remove.mockImplementation(async (...args: unknown[]) => {
        if (String(args[2]).includes("legacy")) {
          throw new Error("alias denied");
        }
        return true;
      });
      await h.service.run(action, [
        job("first", environment, "https://legacy.example/job/first/"),
        job("second")
      ]);
      assert.equal(remove.mock.calls.length, 3);
      assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
      assert.match(lines.join("\n"), /alias denied/);
      assert.match(lines.join("\n"), /1 failed, 1 succeeded/);
    }
  );

  it("refreshes failed remote mutations even with no successful requests", async () => {
    const h = harness();
    h.dataService.cancelQueueItem.mockRejectedValue(new Error("timed out"));
    await h.service.run("cancel", [queue(1)]);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
    assert.equal(error.mock.calls.length, 1);
    assert.match(lines.join("\n"), /timed out/);
  });

  it.each(["unwatch", "unpin"] as const)(
    "awaits every %s alias before reporting a partial failure",
    async (action) => {
      const h = harness();
      const remove = action === "unwatch" ? h.watchStore.removeWatch : h.pinStore.removePin;
      let resolveRaw: ((removed: boolean) => void) | undefined;
      const rawRemoval = new Promise<boolean>((resolve) => {
        resolveRaw = resolve;
      });
      remove.mockImplementation(async (...args: unknown[]) => {
        if (String(args[2]).includes("legacy")) {
          return rawRemoval;
        }
        throw new Error("canonical alias denied");
      });
      let settled = false;
      const running = h.service
        .run(action, [job("demo", environment, "https://legacy.example/job/demo/")])
        .finally(() => {
          settled = true;
        });
      await vi.waitFor(() => assert.equal(remove.mock.calls.length, 2));
      assert.equal(settled, false);
      assert.equal(information.mock.calls.length, 0);
      assert.equal(error.mock.calls.length, 0);
      assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 0);
      resolveRaw?.(true);
      await running;
      assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
      assert.match(lines.join("\n"), /canonical alias denied/);
      assert.match(lines.join("\n"), /1 failed/);
      assert.equal(information.mock.calls.length, 0);
    }
  );

  it("treats terminate and kill like stop for eligibility", () => {
    const completed = Object.assign(build(2), { isBuilding: false });
    for (const action of ["terminate", "kill"] as const) {
      assert.equal(isBulkActionEligible(action, build(1)), true);
      assert.equal(isBulkActionEligible(action, completed), false);
      assert.equal(isBulkActionEligible(action, job("demo")), false);
    }
  });
});

describe("BulkActionService stop escalation", () => {
  it("terminates Pipeline runs after a modal and starts the next follow-up", async () => {
    const h = harness();
    await h.service.run("terminate", [build(1)]);
    assert.equal(warning.mock.calls.length, 1);
    const [message, options, label] = warning.mock.calls[0];
    assert.match(message, /Terminate Builds: 1 eligible/);
    assert.equal((options as { modal: boolean }).modal, true);
    assert.equal(label, "Terminate Builds");
    assert.deepEqual(h.dataService.escalateBuildStop.mock.calls[0], [
      environment,
      "https://ci.example/job/demo/1/",
      "term"
    ]);
    assert.equal(h.dataService.stopBuild.mock.calls.length, 0);
    assert.equal(h.refreshHost.fullEnvironmentRefresh.mock.calls.length, 1);
    assert.equal(h.escalation.followUp.mock.calls.length, 1);
    assert.equal(h.escalation.followUp.mock.calls[0][0], "terminate");
  });

  it("skips the Terminate modal when the follow-up prompt already confirmed it", async () => {
    const h = harness();
    await h.escalationRun("terminate", [build(1)], { confirmed: true });
    assert.equal(warning.mock.calls.length, 0);
    assert.equal(h.dataService.escalateBuildStop.mock.calls.length, 1);
  });

  it("always shows the Kill modal with the hard-kill consequences", async () => {
    const h = harness();
    warning.mockResolvedValueOnce(undefined);
    await h.escalationRun("kill", [build(1)], { confirmed: true });
    assert.equal(warning.mock.calls.length, 1);
    const [, options, label] = warning.mock.calls[0];
    assert.equal(label, "Kill Builds");
    assert.match((options as { detail: string }).detail, /post and finally blocks will not run/);
    assert.match((options as { detail: string }).detail, /locks, or workspaces/);
    assert.equal(h.dataService.escalateBuildStop.mock.calls.length, 0);

    await h.service.run("kill", [build(1)]);
    assert.deepEqual(h.dataService.escalateBuildStop.mock.calls[0]?.[2], "kill");
    assert.equal(h.escalation.followUp.mock.calls.length, 0);
  });

  it("reports unsupported and finished builds without following up", async () => {
    const h = harness();
    h.dataService.escalateBuildStop.mockResolvedValueOnce("unsupported");
    await h.service.run("terminate", [build(1)]);
    h.dataService.escalateBuildStop.mockResolvedValueOnce("unsupported");
    await h.service.run("kill", [build(2)]);
    h.dataService.escalateBuildStop.mockResolvedValueOnce("not-running");
    await h.service.run("terminate", [build(3)]);
    assert.match(lines.join("\n"), /Terminate builds: 1 unsupported/);
    assert.match(lines.join("\n"), /Kill builds: 1 unsupported/);
    assert.match(lines.join("\n"), /Terminate builds: 1 unchanged/);
    assert.equal(h.escalation.followUp.mock.calls.length, 0);
    assert.equal(error.mock.calls.length, 0);
  });

  it("follows up only on builds whose Stop request succeeded", async () => {
    const h = harness();
    h.dataService.stopBuild.mockImplementation(async (...args: unknown[]) => {
      if (String(args[1]).endsWith("/2/")) {
        throw new Error("permission denied");
      }
    });
    await h.service.run("stop", [build(1), build(2), job("demo")]);
    assert.equal(h.escalation.followUp.mock.calls.length, 1);
    const [stage, items] = h.escalation.followUp.mock.calls[0];
    assert.equal(stage, "stop");
    assert.deepEqual(
      items.map((item) => (item as { buildNumber: number }).buildNumber),
      [1]
    );
  });

  it("does not follow up when nothing was stopped and disposes the follow-up", async () => {
    const h = harness();
    h.dataService.stopBuild.mockRejectedValue(new Error("timed out"));
    await h.service.run("stop", [build(1)]);
    await h.service.run("cancel", [queue(1)]);
    assert.equal(h.escalation.followUp.mock.calls.length, 0);
    h.service.dispose();
    assert.equal(h.escalation.dispose.mock.calls.length, 1);
  });
});
