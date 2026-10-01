import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import { assessCommit } from "../src/currentBranch/CurrentBranchCommitHistory";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type {
  CurrentBranchCommitHistory,
  CommitHistory
} from "../src/currentBranch/CurrentBranchCommitHistory";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsStatusRefreshService } from "../src/services/JenkinsStatusRefreshService";
import type { BuildDetailsPanelLauncher } from "../src/panels/BuildDetailsPanelLauncher";
import { JenkinsCommitWatchStore, type CommitWatch } from "../src/storage/JenkinsCommitWatchStore";

const info = vi.fn(async (..._args: unknown[]) => undefined);
const warning = vi.fn(async (..._args: unknown[]) => undefined);
vi.doMock("vscode", () => ({
  window: { showInformationMessage: info, showWarningMessage: warning, showErrorMessage: vi.fn() }
}));
const { CurrentBranchCommitWatchService } = await import(
  "../src/currentBranch/CurrentBranchCommitWatchService"
);

const head = "a".repeat(40);
const environment = { environmentId: "ci", scope: "workspace" as const, url: "https://ci.test" };
const watch: CommitWatch = {
  id: "original",
  head,
  repositoryUri: "file:///app",
  repositoryLabel: "app",
  repositories: ["github.com/team/app"],
  environment,
  jobUrl: "https://ci.test/job/main/",
  label: "main",
  createdAt: 1
};

function setup() {
  const values = new Map<string, unknown>();
  const update = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });
  const memento = {
    keys: () => [...values.keys()],
    get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
    update
  } as vscode.Memento;
  const store = new JenkinsCommitWatchStore(memento);
  let history: CommitHistory = { job: { name: "main", url: watch.jobUrl }, builds: [] };
  const load = vi.fn(async () => history);
  const data = { getBuildDetails: vi.fn() };
  const envs = {
    listEnvironmentsWithScope: vi.fn(async () => [
      { id: "ci", scope: "workspace", url: environment.url }
    ])
  };
  const launcher = { show: vi.fn(async () => undefined) };
  const service = (ticks = {} as JenkinsStatusRefreshService) =>
    new CurrentBranchCommitWatchService(
      store,
      { load } as unknown as CurrentBranchCommitHistory,
      data as unknown as JenkinsDataService,
      envs as unknown as JenkinsEnvironmentStore,
      ticks,
      launcher as unknown as BuildDetailsPanelLauncher
    );
  return {
    store,
    update,
    service,
    envs,
    data,
    load,
    setHistory: (next: CommitHistory) => {
      history = next;
    }
  };
}

function completedHistory(): CommitHistory {
  return {
    job: { name: "main", url: watch.jobUrl },
    builds: [
      {
        number: 2,
        url: `${watch.jobUrl}2/`,
        building: false,
        result: "SUCCESS",
        actions: [
          { remoteUrls: ["https://github.com/team/app.git"], lastBuiltRevision: { SHA1: head } }
        ]
      }
    ]
  };
}

beforeEach(() => {
  info.mockClear();
  warning.mockClear();
});

describe("persistent commit watches", () => {
  it("re-registering a watch preserves its newer observed attempt", async () => {
    const h = setup();
    const id = JSON.stringify([
      watch.repositoryUri,
      environment.scope,
      environment.environmentId,
      environment.url,
      watch.jobUrl,
      head,
      watch.repositories
    ]);
    await h.store.add({ ...watch, id, observedBuild: { number: 3, url: `${watch.jobUrl}3/` } });
    const history = completedHistory();
    history.builds.push({ number: 3, url: `${watch.jobUrl}3/`, building: true, actions: [] });
    h.setHistory(history);
    const checkout = { head, repositories: watch.repositories, dirty: false };
    const state = {
      kind: "matched",
      checkout,
      environment,
      jobUrl: watch.jobUrl,
      jobName: "main",
      branchName: "main",
      repository: { repositoryUriString: watch.repositoryUri, repositoryLabel: "app" },
      commit: assessCommit(history, checkout)
    } as CurrentBranchState;
    await h.service().watch(state);
    expect(info).not.toHaveBeenCalled();
    expect(h.store.list()[0]?.observedBuild?.number).toBe(3);
  });

  it("resumes original identity and persists completion before notifying once", async () => {
    const h = setup();
    await h.store.add(watch);
    const first = h.service();
    await first.poll();
    expect(h.store.list()).toHaveLength(1);
    first.dispose();
    h.setHistory(completedHistory());
    const restarted = h.service();
    await restarted.poll();
    expect(h.store.list()).toHaveLength(0);
    expect(info.mock.calls[0]?.[0]).toContain("app aaaaaaa passed");
    await restarted.poll();
    expect(info).toHaveBeenCalledTimes(1);
    expect(h.load).toHaveBeenCalledWith(environment, watch.jobUrl);
  });

  it("does not resurrect or notify a watch cancelled during a pending poll", async () => {
    const h = setup();
    await h.store.add(watch);
    let resolve!: (history: CommitHistory) => void;
    h.load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const pending = h.service().poll();
    await vi.waitFor(() => expect(h.load).toHaveBeenCalled());
    await h.store.remove(watch.id);
    resolve(completedHistory());
    await pending;
    expect(h.store.list()).toEqual([]);
    expect(info).not.toHaveBeenCalled();
  });

  it("pauses a watch rather than following an environment URL change", async () => {
    const h = setup();
    await h.store.add(watch);
    h.envs.listEnvironmentsWithScope.mockResolvedValue([
      { id: "ci", scope: "workspace", url: "https://different.test" }
    ]);
    await h.service().poll();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.store.list()[0]?.blockedReason).toContain("URL changed");
  });

  it("keeps following an observed build beyond the bounded history window", async () => {
    const h = setup();
    await h.store.add({ ...watch, observedBuild: { number: 2, url: `${watch.jobUrl}2/` } });
    h.data.getBuildDetails.mockResolvedValue(completedHistory().builds[0]);
    await h.service().poll();
    expect(h.data.getBuildDetails).toHaveBeenCalledWith(environment, `${watch.jobUrl}2/`, {
      revisionsOnly: true,
      bypassCache: true
    });
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent store changes without losing other watches", async () => {
    const h = setup();
    await Promise.all([h.store.add(watch), h.store.add({ ...watch, id: "second" })]);
    expect(h.store.list()).toHaveLength(2);
    await Promise.all([
      h.store.remove(watch.id),
      h.store.update({ ...watch, blockedReason: "stale" })
    ]);
    expect(h.store.list().map((entry) => entry.id)).toEqual(["second"]);
  });

  it("does not rewrite pending watches whose state did not change", async () => {
    const h = setup();
    await h.store.add(watch);
    const service = h.service();
    await service.poll();
    const writesAfterFirstPoll = h.update.mock.calls.length;
    await service.poll();
    await service.poll();
    expect(h.update).toHaveBeenCalledTimes(writesAfterFirstPoll);
    expect(h.store.list()).toHaveLength(1);
  });

  it("delays the first poll at startup until the delay or a status tick", async () => {
    vi.useFakeTimers();
    try {
      const h = setup();
      await h.store.add(watch);
      let tick: (() => void) | undefined;
      const ticks = {
        onDidTick: (listener: () => void) => {
          tick = listener;
          return { dispose: () => undefined };
        }
      } as unknown as JenkinsStatusRefreshService;

      const delayed = h.service(ticks);
      delayed.start({ initialDelayMs: 8_000 });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(h.load).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.load).toHaveBeenCalledTimes(1);
      delayed.dispose();

      const ticked = h.service(ticks);
      ticked.start({ initialDelayMs: 8_000 });
      tick?.();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.load).toHaveBeenCalledTimes(2);
      ticked.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches history once per job for multiple pending commit watches", async () => {
    const h = setup();
    await h.store.add(watch);
    await h.store.add({ ...watch, id: "other-commit", head: "b".repeat(40) });
    await h.service().poll();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.store.list()).toHaveLength(2);
  });

  it("follows a newer verified attempt even if the observed older build was deleted", async () => {
    const h = setup();
    await h.store.add({ ...watch, observedBuild: { number: 1, url: `${watch.jobUrl}1/` } });
    h.setHistory(completedHistory());
    h.data.getBuildDetails.mockRejectedValue(new Error("deleted"));
    await h.service().poll();
    expect(h.data.getBuildDetails).not.toHaveBeenCalled();
    expect(h.store.list()).toEqual([]);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("never falls back to an older pass when the observed attempt loses revision evidence", async () => {
    const h = setup();
    await h.store.add({ ...watch, observedBuild: { number: 3, url: `${watch.jobUrl}3/` } });
    const history = completedHistory();
    history.builds.push({ number: 3, url: `${watch.jobUrl}3/`, building: true, actions: [] });
    h.setHistory(history);
    await h.service().poll();
    expect(info).not.toHaveBeenCalled();
    expect(h.store.list()[0]?.observedBuild?.number).toBe(3);
    expect(h.store.list()[0]?.blockedReason).toContain("no longer verifiable");
    h.setHistory(completedHistory());
    h.data.getBuildDetails.mockResolvedValue(history.builds[1]);
    await h.service().poll();
    expect(info).not.toHaveBeenCalled();
    expect(h.store.list()[0]?.observedBuild?.number).toBe(3);
  });
});
