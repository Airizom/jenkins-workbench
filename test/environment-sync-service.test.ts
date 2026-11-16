import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener<T> = (event: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
  get size(): number {
    return this.listeners.size;
  }
}

const windowState = new Emitter<{ focused: boolean }>();
const configuration = new Emitter<{ affectsConfiguration: (key: string) => boolean }>();
let syncEnabled: boolean | undefined = true;

vi.doMock("vscode", () => ({
  window: { onDidChangeWindowState: windowState.event },
  workspace: {
    onDidChangeConfiguration: configuration.event,
    getConfiguration: () => ({
      get: <T>(key: string, fallback: T) =>
        key === "syncEnvironments" && syncEnabled !== undefined ? syncEnabled : fallback
    })
  }
}));

const { EnvironmentSyncService, SYNCED_GLOBAL_STATE_KEYS } = await import(
  "../src/environments/sync/EnvironmentSyncService"
);

const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";
const PINNED_JOBS_KEY = "jenkinsWorkbench.pinnedJobs";
const WATCHED_JOBS_KEY = "jenkinsWorkbench.watchedJobs";

function setup(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  const globalState = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    setKeysForSync: vi.fn()
  };
  const storeChanges = new Emitter<unknown>();
  const refreshes = new Emitter<string | undefined>();
  const environmentStore = {
    notifyExternalChange: vi.fn(),
    onDidChange: storeChanges.event
  };
  const clientProvider = { invalidateClient: vi.fn() };
  const refreshHost = {
    fullEnvironmentRefresh: vi.fn(() => ({ executed: true })),
    onDidRefreshEnvironment: refreshes.event
  };
  const syncNoEnvironmentsContext = vi.fn(async () => undefined);
  const service = new EnvironmentSyncService({
    globalState,
    environmentStore: environmentStore as never,
    clientProvider,
    refreshHost,
    syncNoEnvironmentsContext,
    checkDelayMs: 100
  });
  return {
    values,
    globalState,
    storeChanges,
    refreshes,
    environmentStore,
    clientProvider,
    refreshHost,
    syncNoEnvironmentsContext,
    service
  };
}

async function focusAndSettle(): Promise<void> {
  windowState.fire({ focused: true });
  await vi.advanceTimersByTimeAsync(150);
}

describe("EnvironmentSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    syncEnabled = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs environments, pins and watches but not workspace-only rebase bookkeeping", () => {
    expect(SYNCED_GLOBAL_STATE_KEYS).toEqual([ENVIRONMENTS_KEY, PINNED_JOBS_KEY, WATCHED_JOBS_KEY]);
  });

  it("registers the synced keys on start when the setting is on", () => {
    const { service, globalState } = setup();
    service.start();
    expect(globalState.setKeysForSync).toHaveBeenCalledWith(SYNCED_GLOBAL_STATE_KEYS);
    service.dispose();
  });

  it("registers no keys when the setting is off, and re-registers when it is toggled", () => {
    syncEnabled = false;
    const { service, globalState } = setup();
    service.start();
    expect(globalState.setKeysForSync).toHaveBeenLastCalledWith([]);

    syncEnabled = true;
    configuration.fire({
      affectsConfiguration: (key) => key === "jenkinsWorkbench.syncEnvironments"
    });
    expect(globalState.setKeysForSync).toHaveBeenLastCalledWith(SYNCED_GLOBAL_STATE_KEYS);

    syncEnabled = false;
    configuration.fire({
      affectsConfiguration: (key) => key === "jenkinsWorkbench.syncEnvironments"
    });
    expect(globalState.setKeysForSync).toHaveBeenLastCalledWith([]);

    configuration.fire({ affectsConfiguration: () => false });
    expect(globalState.setKeysForSync).toHaveBeenCalledTimes(3);
    service.dispose();
  });

  it("does nothing on focus when the synced keys are unchanged", async () => {
    const harness = setup({
      [ENVIRONMENTS_KEY]: [{ id: "a", url: "https://a.example/" }],
      [WATCHED_JOBS_KEY]: [{ environmentId: "a", jobUrl: "https://a.example/job/x/" }]
    });
    harness.service.start();

    await focusAndSettle();

    expect(harness.clientProvider.invalidateClient).not.toHaveBeenCalled();
    expect(harness.environmentStore.notifyExternalChange).not.toHaveBeenCalled();
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    harness.service.dispose();
  });

  it("invalidates changed, added and removed environments, announces and refreshes on focus", async () => {
    const harness = setup({
      [ENVIRONMENTS_KEY]: [
        { id: "same", url: "https://same.example/" },
        { id: "changed", url: "https://changed.example/" },
        { id: "removed", url: "https://removed.example/" }
      ]
    });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, [
      { id: "same", url: "https://same.example/" },
      { id: "changed", url: "https://changed.example/", authHint: { type: "basic" } },
      { id: "added", url: "https://added.example/" }
    ]);

    await focusAndSettle();

    expect(harness.clientProvider.invalidateClient.mock.calls.sort()).toEqual([
      ["global", "added"],
      ["global", "changed"],
      ["global", "removed"]
    ]);
    expect(harness.environmentStore.notifyExternalChange).toHaveBeenCalledWith("global");
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledWith({ trigger: "system" });

    // The next focus with nothing new is a no-op.
    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("refreshes for synced pin or watch membership but ignores watch status updates", async () => {
    const watch = { environmentId: "a", jobUrl: "https://a.example/job/x/" };
    const harness = setup({ [WATCHED_JOBS_KEY]: [watch] });
    harness.service.start();

    harness.values.set(WATCHED_JOBS_KEY, [{ ...watch, lastStatus: "failure" }]);
    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();

    harness.values.set(PINNED_JOBS_KEY, [watch]);
    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    expect(harness.clientProvider.invalidateClient).not.toHaveBeenCalled();
    expect(harness.environmentStore.notifyExternalChange).not.toHaveBeenCalled();
    harness.service.dispose();
  });

  it("debounces focus bursts into one check", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [] });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, [{ id: "a", url: "https://a.example/" }]);

    windowState.fire({ focused: true });
    windowState.fire({ focused: false });
    windowState.fire({ focused: true });
    await vi.advanceTimersByTimeAsync(150);

    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("absorbs a record this window's store wrote without refreshing again", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [] });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, [{ id: "a", url: "https://a.example/" }]);
    harness.storeChanges.fire({ kind: "environment-added", scope: "global", environmentId: "a" });

    expect(harness.clientProvider.invalidateClient).toHaveBeenCalledWith("global", "a");

    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
    expect(harness.environmentStore.notifyExternalChange).not.toHaveBeenCalled();
    harness.service.dispose();
  });

  it("announces a synced environment that arrived unfocused even after a local refresh", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [{ id: "a", url: "https://a.example/" }] });
    harness.service.start();

    // Settings Sync writes a new environment while the window is unfocused...
    harness.values.set(ENVIRONMENTS_KEY, [
      { id: "a", url: "https://a.example/" },
      { id: "synced", url: "https://synced.example/" }
    ]);
    // ...then the status poller refreshes an environment before the window regains focus.
    harness.refreshes.fire("a");
    harness.refreshes.fire(undefined);
    harness.storeChanges.fire({ kind: "bulk-update", scope: "global" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();

    await focusAndSettle();

    expect(harness.clientProvider.invalidateClient).toHaveBeenCalledWith("global", "synced");
    expect(harness.environmentStore.notifyExternalChange).toHaveBeenCalledWith("global");
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("keeps a pending synced environment when this window edits a different one", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [{ id: "a", url: "https://a.example/" }] });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, [
      { id: "a", url: "https://a.example/" },
      { id: "synced", url: "https://synced.example/" }
    ]);
    harness.values.set(ENVIRONMENTS_KEY, [
      { id: "a", url: "https://a2.example/" },
      { id: "synced", url: "https://synced.example/" }
    ]);
    harness.storeChanges.fire({ kind: "environment-updated", scope: "global", environmentId: "a" });
    harness.clientProvider.invalidateClient.mockClear();

    await focusAndSettle();

    expect(harness.clientProvider.invalidateClient.mock.calls).toEqual([["global", "synced"]]);
    expect(harness.environmentStore.notifyExternalChange).toHaveBeenCalledWith("global");
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("ignores workspace-scope store changes and refreshes once for local pin edits", async () => {
    const watch = { environmentId: "a", jobUrl: "https://a.example/job/x/" };
    const harness = setup({ [ENVIRONMENTS_KEY]: [] });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, [{ id: "a", url: "https://a.example/" }]);
    harness.storeChanges.fire({
      kind: "environment-added",
      scope: "workspace",
      environmentId: "a"
    });
    expect(harness.clientProvider.invalidateClient).not.toHaveBeenCalled();

    harness.values.set(PINNED_JOBS_KEY, [watch]);
    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);

    await focusAndSettle();
    expect(harness.refreshHost.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("syncs the no-environments context itself when the refresh did not run", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [{ id: "a", url: "https://a.example/" }] });
    harness.refreshHost.fullEnvironmentRefresh.mockReturnValue({ executed: false });
    harness.service.start();
    harness.values.set(ENVIRONMENTS_KEY, []);

    await focusAndSettle();

    expect(harness.syncNoEnvironmentsContext).toHaveBeenCalledTimes(1);
    harness.service.dispose();
  });

  it("stops listening once disposed", async () => {
    const harness = setup({ [ENVIRONMENTS_KEY]: [] });
    harness.service.start();
    harness.service.dispose();
    harness.values.set(ENVIRONMENTS_KEY, [{ id: "a", url: "https://a.example/" }]);

    await focusAndSettle();

    expect(windowState.size).toBe(0);
    expect(harness.refreshHost.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });
});
