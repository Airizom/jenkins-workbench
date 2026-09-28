import { expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

type Listener = () => void;
function event() {
  const listeners = new Set<Listener>();
  return {
    event: (listener: Listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: () => {
      for (const listener of [...listeners]) listener();
    }
  };
}
const accept = event();
const hide = event();
const quickPick = {
  title: "",
  placeholder: "",
  matchOnDescription: false,
  busy: false,
  enabled: true,
  items: [] as Array<{ label: string; url: string; description?: string }>,
  selectedItems: [] as Array<{ url: string }>,
  onDidAccept: accept.event,
  onDidHide: hide.event,
  show: vi.fn(),
  hide: vi.fn(() => hide.fire()),
  dispose: vi.fn()
};
vi.doMock("vscode", () => ({ window: { createQuickPick: () => quickPick } }));
const { chooseHistoryBaseline } = await import("../src/panels/jobHistory/HistoryBaselinePicker");
const noEvent = () => ({ dispose: () => undefined });

it("shows a busy picker while jobs load, then stores the chosen baseline job", async () => {
  let resolveJobs!: (jobs: Array<{ fullName: string; url: string }>) => void;
  const set = vi.fn();
  const dependencies = {
    baseline: {
      project: async () => ({ url: "https://jenkins.test/job/p/", multibranch: true }),
      store: { get: () => "https://jenkins.test/job/p/job/main", set }
    },
    history: { run: (_request: unknown, task: () => unknown) => task() },
    data: {
      getAllJobsForEnvironment: () =>
        new Promise((done) => {
          resolveJobs = done;
        })
    },
    environments: { onDidChange: noEvent }
  };
  const request = {
    environment: { environmentId: "e", scope: "workspace" as const, url: "https://jenkins.test/" },
    jobUrl: "https://jenkins.test/job/p/job/feature/",
    count: 20 as const,
    active: () => true
  };
  const pending = chooseHistoryBaseline(
    { onDidDispose: noEvent, onDidChangeViewState: noEvent } as unknown as vscodeTypes.WebviewPanel,
    dependencies as never,
    request,
    false
  );
  await vi.waitFor(() => expect(quickPick.show).toHaveBeenCalled());
  expect(quickPick.busy).toBe(true);
  expect(quickPick.enabled).toBe(false);
  resolveJobs([
    { fullName: "p/main", url: "https://jenkins.test/job/p/job/main/" },
    { fullName: "p/dev", url: "https://jenkins.test/job/p/job/dev/" }
  ]);
  await vi.waitFor(() => expect(quickPick.busy).toBe(false));
  expect(quickPick.items[0].description).toBe("Current baseline");
  quickPick.selectedItems = [quickPick.items[1]];
  accept.fire();
  expect(await pending).toBe(true);
  expect(set).toHaveBeenCalledWith(
    request.environment,
    "https://jenkins.test/job/p/",
    "https://jenkins.test/job/p/job/dev/"
  );
  expect(quickPick.dispose).toHaveBeenCalled();
});

it("treats dismissing the picker during the job lookup as a cancel, not a failure", async () => {
  let rejectJobs!: (error: Error) => void;
  const set = vi.fn();
  const dependencies = {
    baseline: {
      project: async () => ({ url: "https://jenkins.test/job/p/", multibranch: true }),
      store: { get: () => undefined, set }
    },
    history: { run: (_request: unknown, task: () => unknown) => task() },
    data: {
      getAllJobsForEnvironment: () =>
        new Promise((_done, fail) => {
          rejectJobs = fail;
        })
    },
    environments: { onDidChange: noEvent }
  };
  quickPick.show.mockClear();
  const pending = chooseHistoryBaseline(
    { onDidDispose: noEvent, onDidChangeViewState: noEvent } as unknown as vscodeTypes.WebviewPanel,
    dependencies as never,
    {
      environment: {
        environmentId: "e",
        scope: "workspace" as const,
        url: "https://jenkins.test/"
      },
      jobUrl: "https://jenkins.test/job/p/job/feature/",
      count: 20 as const,
      active: () => true
    },
    false
  );
  await vi.waitFor(() => expect(quickPick.show).toHaveBeenCalled());
  quickPick.hide();
  rejectJobs(new Error("Operation cancelled"));
  expect(await pending).toBe(false);
  expect(set).not.toHaveBeenCalled();
});
