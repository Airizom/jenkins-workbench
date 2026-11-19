import type * as vscode from "vscode";
import { afterEach, expect, it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

const commands = new Map<string, (item: unknown) => void>();
vi.doMock("vscode", () => ({
  ...vscodeStub,
  commands: {
    registerCommand: (id: string, handler: (item: unknown) => void) => {
      commands.set(id, handler);
      return { dispose: () => commands.delete(id) };
    }
  },
  StatusBarAlignment: { Left: 1 },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createStatusBarItem: () => ({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })
  }
}));

const { resolveBulkActionTargets } = await import("../src/commands/bulk/BulkActionTargets");
const { showBuildDetails } = await import("../src/commands/build/BuildNavigationHandlers");
const { resolveDisplayedFollowTarget } = await import(
  "../src/panels/buildDetails/BuildDetailsPanelState"
);
const { registerBuildFollowCommands } = await import("../src/commands/BuildFollowCommands");
const { TreeBuildFollowPresentation } = await import("../src/tree/TreeBuildFollowPresentation");
const { BuildCompletionTracker } = await import(
  "../src/services/buildFollow/BuildCompletionTracker"
);
const { BuildTreeItem, QueueItemTreeItem, BuildQueueFolderTreeItem, JobTreeItem } = await import(
  "../src/tree/TreeItems"
);

afterEach(() => {
  commands.clear();
  vi.useRealTimers();
});

it("updates each rendered tree copy from the shared tracker and routes actions to the clicked run", () => {
  vi.useFakeTimers();
  const getBuildDetails = vi.fn();
  const getQueueItem = vi.fn();
  const tracker = new BuildCompletionTracker(
    { getBuildDetails, getQueueItem },
    {
      isCurrentController: () => true,
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    }
  );
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerBuildFollowCommands(context, tracker);
  const invoke = (command: string, item: unknown) => {
    const handler = commands.get(`jenkinsWorkbench.${command}`);
    expect(handler).toBeDefined();
    handler?.(item);
  };
  const changed = vi.fn();
  const tree = new TreeBuildFollowPresentation(tracker, changed);
  const environment = {
    environmentId: "one",
    scope: "workspace" as const,
    url: "https://jenkins.test/"
  };
  const taskUrl = `${environment.url}job/build/`;
  const run = { number: 7, url: `${taskUrl}7/`, building: true, keepLog: true };
  const job = { environment, presentation: "job" as const, jobUrl: taskUrl, label: "build" };
  const jobsRow = new JobTreeItem({ ...job, variant: "default" });
  const pinnedRow = new JobTreeItem({ ...job, variant: "quickAccess" });
  const build = new BuildTreeItem(environment, run, jobsRow.jobScope, {}, undefined, true);
  const pinnedBuild = new BuildTreeItem(environment, run, pinnedRow.jobScope);
  const finished = new BuildTreeItem(environment, {
    ...run,
    building: false,
    number: 6,
    url: `${taskUrl}6/`
  });
  const queue = new QueueItemTreeItem(environment, { id: 9, name: "build", position: 1, taskUrl });
  const queues = new BuildQueueFolderTreeItem(environment);
  tree.trackChildren(jobsRow, [build, finished]);
  tree.trackChildren(pinnedRow, [pinnedBuild]);
  tree.trackChildren(queues, [queue]);

  invoke("followBuild", finished);
  expect(tracker.count).toBe(0);
  invoke("followBuild", build);
  expect(changed.mock.calls).toEqual([[build], [pinnedBuild]]);
  expect(tree.getTreeItem(build).contextValue).toBe(
    "buildRunning awaitingInput keptForever followed"
  );
  expect(tree.getTreeItem(pinnedBuild).contextValue).toBe("buildRunning keptForever followed");
  expect(tree.getTreeItem(queue)).toBe(queue);
  expect(tree.getTreeItem(finished)).toBe(finished);
  expect(build.contextValue).toBe("buildRunning awaitingInput keptForever");

  changed.mockClear();
  invoke("followQueueItem", queue);
  expect(changed.mock.calls).toEqual([[queue]]);
  expect(tree.getTreeItem(queue).contextValue).toBe("queueItem followed");
  expect(getBuildDetails).not.toHaveBeenCalled();

  tree.trackChildren(pinnedRow, []);
  changed.mockClear();
  invoke("stopFollowing", build);
  expect(changed.mock.calls).toEqual([[build]]);
  expect(tree.getTreeItem(build)).toBe(build);
  expect(tracker.isFollowingQueueItem(environment, queue.queueId)).toBe(true);
  invoke("stopFollowing", queue);
  expect(tree.getTreeItem(queue)).toBe(queue);
  tree.dispose();
  changed.mockClear();
  invoke("followBuild", build);
  expect(changed).not.toHaveBeenCalled();
  tracker.dispose();
  context.subscriptions.forEach((item) => {
    item.dispose();
  });
});

it("opens a tree-followed build at the same controller endpoint used by the panel follow action", async () => {
  vi.useFakeTimers();
  const environment = {
    environmentId: "one",
    scope: "workspace" as const,
    url: "https://jenkins.test/"
  };
  const run = {
    number: 42,
    url: `${environment.url}view/team/custom-runs/job/app/42/`,
    building: true
  };
  const row = new BuildTreeItem(environment, run);
  const getBuildDetails = vi.fn(async () => run);
  const tracker = new BuildCompletionTracker(
    { getBuildDetails, getQueueItem: vi.fn() },
    {
      isCurrentController: () => true,
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    }
  );
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerBuildFollowCommands(context, tracker);
  commands.get("jenkinsWorkbench.followBuild")?.(row);

  const show = vi.fn(async (_request: { buildUrl: string }) => undefined);
  await showBuildDetails({ show }, row);
  expect(show).toHaveBeenCalledWith({
    environment,
    buildUrl: run.url,
    label: "#42"
  });
  const target = resolveDisplayedFollowTarget(environment, show.mock.calls[0][0].buildUrl, run);
  if (!target) throw new Error("Missing displayed run");
  expect(tracker.isFollowingBuild(environment, target.buildUrl, "configured")).toBe(true);
  expect(tracker.follow(target, "configured")).toBe("already-following");
  expect(tracker.count).toBe(1);
  const sibling = new BuildTreeItem(environment, { ...run, url: `${environment.url}job/app/42/` });
  expect(tracker.isFollowingBuild(environment, sibling.buildUrl)).toBe(false);
  const stops = resolveBulkActionTargets("stop", [row, sibling]);
  expect(stops.targets.map((target) => target.kind === "build" && target.url)).toEqual([
    run.url,
    sibling.buildUrl
  ]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(getBuildDetails).toHaveBeenCalledTimes(1);
  expect(getBuildDetails).toHaveBeenCalledWith(
    environment,
    run.url,
    expect.objectContaining({ statusOnly: true })
  );
  tracker.dispose();
});

it("keeps a followed #41 isolated from a row labeled #42 that advertises #41's URL", async () => {
  vi.useFakeTimers();
  const environment = { environmentId: "one", scope: "workspace" as const, url: "https://ci/" };
  const jobUrl = `${environment.url}job/app/`;
  const run = { url: `${jobUrl}41/`, number: 41, building: true };
  const valid = new BuildTreeItem(environment, run);
  const conflicting = new BuildTreeItem(environment, { ...run, number: 42 });
  const parent = new JobTreeItem({
    environment,
    jobUrl,
    label: "app",
    presentation: "job",
    variant: "default"
  });
  const tracker = new BuildCompletionTracker(
    { getBuildDetails: vi.fn(), getQueueItem: vi.fn() },
    {
      isCurrentController: () => true,
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    }
  );
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerBuildFollowCommands(context, tracker);
  const changed = vi.fn();
  const tree = new TreeBuildFollowPresentation(tracker, changed);
  tree.trackChildren(parent, [valid, conflicting]);
  commands.get("jenkinsWorkbench.followBuild")?.(valid);
  expect(changed.mock.calls).toEqual([[valid]]);
  expect(tree.getTreeItem(conflicting).contextValue).toBe("buildRunning followUnavailable");
  changed.mockClear();
  commands.get("jenkinsWorkbench.followBuild")?.(conflicting);
  commands.get("jenkinsWorkbench.stopFollowing")?.(conflicting);
  expect(tracker.count).toBe(1);
  expect(tracker.isFollowingBuild(environment, run.url)).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  const show = vi.fn();
  await showBuildDetails({ show }, conflicting);
  expect(show).not.toHaveBeenCalled();
  commands.get("jenkinsWorkbench.stopFollowing")?.(valid);
  expect(changed.mock.calls).toEqual([[valid]]);
  expect(tracker.count).toBe(0);
  tree.dispose();
  tracker.dispose();
  context.subscriptions.forEach((item) => {
    item.dispose();
  });
});

it("keeps cached rows for different queue IDs apart when Jenkins reuses a numbered URL", async () => {
  vi.useFakeTimers();
  const environment = { environmentId: "one", scope: "workspace" as const, url: "https://ci/" };
  const jobUrl = `${environment.url}job/app/`;
  const job = { environment, jobUrl, label: "app", presentation: "job" as const };
  const jobs = new JobTreeItem({ ...job, variant: "default" });
  const pinned = new JobTreeItem({ ...job, variant: "quickAccess" });
  const activity = new JobTreeItem({ ...job, variant: "activity", group: "running" });
  const run = { number: 41, url: `${jobUrl}41/`, building: true, queueId: 302 };
  const current = new BuildTreeItem(environment, run, jobs.jobScope);
  const duplicate = new BuildTreeItem(environment, run, activity.jobScope);
  const stale = new BuildTreeItem(environment, { ...run, queueId: 301 }, pinned.jobScope);
  const tracker = new BuildCompletionTracker(
    {
      getBuildDetails: vi.fn().mockResolvedValue({ ...run, building: false, result: "SUCCESS" }),
      getQueueItem: vi.fn()
    },
    {
      isCurrentController: () => true,
      showBuildDetails: vi.fn(),
      previewLog: vi.fn(),
      refreshEnvironment: vi.fn()
    }
  );
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerBuildFollowCommands(context, tracker);
  const changed = vi.fn();
  const tree = new TreeBuildFollowPresentation(tracker, changed);
  tree.trackChildren(jobs, [current]);
  tree.trackChildren(pinned, [stale]);
  tree.trackChildren(activity, [duplicate]);
  commands.get("jenkinsWorkbench.followBuild")?.(current);
  expect(tracker.isFollowingQueueItem(environment, 302)).toBe(true);
  expect(tree.getTreeItem(duplicate).contextValue).toBe("buildRunning followed");
  expect(tree.getTreeItem(stale).contextValue).toBe("buildRunning followUnavailable");
  expect(changed.mock.calls).toEqual([[current], [stale], [duplicate]]);
  changed.mockClear();
  commands.get("jenkinsWorkbench.stopFollowing")?.(stale);
  commands.get("jenkinsWorkbench.followBuild")?.(stale);
  expect(tracker.count).toBe(1);
  expect(tracker.isFollowingQueueItem(environment, 301)).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  commands.get("jenkinsWorkbench.stopFollowing")?.(duplicate);
  expect(tracker.count).toBe(0);
  expect(tree.getTreeItem(stale)).toBe(stale);
  expect(changed.mock.calls).toEqual([[current], [stale], [duplicate]]);
  for (const queueId of [undefined, -1, 0, 1.5]) {
    const legacy = new BuildTreeItem(environment, { ...run, queueId });
    expect(legacy.queueId).toBeUndefined();
    commands.get("jenkinsWorkbench.followBuild")?.(legacy);
    expect(tree.getTreeItem(legacy).contextValue).toBe("buildRunning followed");
    commands.get("jenkinsWorkbench.stopFollowing")?.(legacy);
    expect(tracker.count).toBe(0);
  }
  const completed = vi.fn();
  tracker.onDidNotifyCompletion(completed);
  commands.get("jenkinsWorkbench.followBuild")?.(stale);
  expect(tracker.isFollowingQueueItem(environment, 301)).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(tracker.count).toBe(0);
  expect(completed).not.toHaveBeenCalled();
  tree.dispose();
  tracker.dispose();
  context.subscriptions.forEach((item) => {
    item.dispose();
  });
});
