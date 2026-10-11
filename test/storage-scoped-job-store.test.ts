import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import type { EnvironmentScope } from "../src/storage/JenkinsEnvironmentStore";
import {
  JenkinsScopedJobStore,
  type ScopedJobStoreEntry,
  mergeScopedJobEntryMetadata
} from "../src/storage/ScopedJobStore";
import { createSerialTaskQueue } from "../src/storage/SerialTaskQueue";

const STORAGE_KEY = "test.scopedJobs";

class InMemoryMemento {
  private readonly storage = new Map<string, unknown>();
  updateCount = 0;

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.updateCount += 1;
    // Yield before persisting so unserialized read-modify-write callers would interleave.
    await new Promise((resolve) => setImmediate(resolve));
    this.storage.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.storage.keys()];
  }
}

class TestScopedJobStore extends JenkinsScopedJobStore<ScopedJobStoreEntry> {
  constructor(context: vscode.ExtensionContext) {
    super(context, STORAGE_KEY);
  }

  add(scope: EnvironmentScope, entry: ScopedJobStoreEntry): Promise<void> {
    return this.addOrUpdate(scope, entry, mergeScopedJobEntryMetadata);
  }

  update(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrl: string,
    update: (entry: ScopedJobStoreEntry) => ScopedJobStoreEntry | undefined
  ): Promise<boolean> {
    return this.updateJob(scope, environmentId, jobUrl, update);
  }

  removeMany(
    scope: EnvironmentScope,
    environmentId: string,
    jobUrls: ReadonlySet<string>
  ): Promise<number> {
    return this.removeJobs(scope, environmentId, jobUrls);
  }

  rename(
    scope: EnvironmentScope,
    environmentId: string,
    oldJobUrl: string,
    newJobUrl: string,
    newJobName?: string
  ): Promise<boolean> {
    return this.updateUrl(
      scope,
      environmentId,
      oldJobUrl,
      newJobUrl,
      newJobName,
      mergeScopedJobEntryMetadata
    );
  }
}

class TrailingSlashInsensitiveStore extends TestScopedJobStore {
  tracked(scope: EnvironmentScope, environmentId: string, jobUrl: string): Promise<boolean> {
    return this.isTracked(scope, environmentId, jobUrl);
  }

  protected override isSameJob(
    entry: ScopedJobStoreEntry,
    other: { environmentId: string; jobUrl: string }
  ): boolean {
    const normalize = (url: string) => url.replace(/\/+$/, "");
    return (
      entry.environmentId === other.environmentId &&
      normalize(entry.jobUrl) === normalize(other.jobUrl)
    );
  }
}

async function createStore(seed: ScopedJobStoreEntry[] = []): Promise<{
  store: TestScopedJobStore;
  workspaceState: InMemoryMemento;
}> {
  const workspaceState = new InMemoryMemento();
  if (seed.length > 0) {
    await workspaceState.update(STORAGE_KEY, seed);
    workspaceState.updateCount = 0;
  }
  const context = {
    workspaceState,
    globalState: new InMemoryMemento()
  } as unknown as vscode.ExtensionContext;
  return { store: new TestScopedJobStore(context), workspaceState };
}

function stored(memento: InMemoryMemento): ScopedJobStoreEntry[] | undefined {
  return memento.get<ScopedJobStoreEntry[]>(STORAGE_KEY);
}

describe("JenkinsScopedJobStore.updateUrl", () => {
  it("merges renamed entries into an existing target and keeps the target position", async () => {
    const { store, workspaceState } = await createStore([
      { environmentId: "env-1", jobUrl: "job/old/", jobName: "old" },
      { environmentId: "env-1", jobUrl: "job/b/", jobName: "b" },
      { environmentId: "env-1", jobUrl: "job/old/", jobKind: "pipeline" },
      { environmentId: "env-2", jobUrl: "job/old/", jobName: "other env" },
      { environmentId: "env-1", jobUrl: "job/new/", jobName: "new", jobKind: "job" }
    ]);

    assert.equal(await store.rename("workspace", "env-1", "job/old/", "job/new/"), true);

    assert.deepEqual(stored(workspaceState), [
      { environmentId: "env-1", jobUrl: "job/b/", jobName: "b" },
      { environmentId: "env-2", jobUrl: "job/old/", jobName: "other env" },
      { environmentId: "env-1", jobUrl: "job/new/", jobName: "old", jobKind: "pipeline" }
    ]);
  });

  it("collapses duplicate old entries at the first old position when no target exists", async () => {
    const { store, workspaceState } = await createStore([
      { environmentId: "env-1", jobUrl: "job/x/" },
      { environmentId: "env-1", jobUrl: "job/old/", jobName: "old" },
      { environmentId: "env-1", jobUrl: "job/b/" },
      { environmentId: "env-1", jobUrl: "job/old/", jobKind: "pipeline" }
    ]);

    assert.equal(await store.rename("workspace", "env-1", "job/old/", "job/new/", "renamed"), true);

    assert.deepEqual(stored(workspaceState), [
      { environmentId: "env-1", jobUrl: "job/x/" },
      { environmentId: "env-1", jobUrl: "job/new/", jobName: "renamed", jobKind: "pipeline" },
      { environmentId: "env-1", jobUrl: "job/b/" }
    ]);
  });

  it("collapses duplicates in place when the old and new URLs are the same", async () => {
    const { store, workspaceState } = await createStore([
      { environmentId: "env-1", jobUrl: "job/a/", jobName: "a" },
      { environmentId: "env-1", jobUrl: "job/b/" },
      { environmentId: "env-1", jobUrl: "job/a/", jobKind: "job" }
    ]);

    assert.equal(await store.rename("workspace", "env-1", "job/a/", "job/a/", "a2"), true);

    assert.deepEqual(stored(workspaceState), [
      { environmentId: "env-1", jobUrl: "job/a/", jobName: "a2", jobKind: "job" },
      { environmentId: "env-1", jobUrl: "job/b/" }
    ]);
  });

  it("returns false without writing when the old URL is not tracked", async () => {
    const { store, workspaceState } = await createStore([
      { environmentId: "env-1", jobUrl: "job/a/" }
    ]);

    assert.equal(await store.rename("workspace", "env-1", "job/missing/", "job/new/"), false);
    assert.equal(workspaceState.updateCount, 0);
  });
});

describe("JenkinsScopedJobStore mutations", () => {
  it("does not write when updateJob makes no change", async () => {
    const seed = [{ environmentId: "env-1", jobUrl: "job/a/" }];
    const { store, workspaceState } = await createStore(seed);

    assert.equal(await store.update("workspace", "env-1", "job/a/", () => undefined), false);
    assert.equal(await store.update("workspace", "env-1", "job/missing/", (entry) => entry), false);
    assert.equal(workspaceState.updateCount, 0);
    assert.deepEqual(stored(workspaceState), seed);
  });

  it("returns 0 without writing when removeJobs receives an empty set", async () => {
    const seed = [{ environmentId: "env-1", jobUrl: "job/a/" }];
    const { store, workspaceState } = await createStore(seed);

    assert.equal(await store.removeMany("workspace", "env-1", new Set()), 0);
    assert.equal(workspaceState.updateCount, 0);
    assert.deepEqual(stored(workspaceState), seed);
  });

  it("applies an overridden isSameJob in isTracked and removeJobs", async () => {
    const workspaceState = new InMemoryMemento();
    const context = {
      workspaceState,
      globalState: new InMemoryMemento()
    } as unknown as vscode.ExtensionContext;
    const store = new TrailingSlashInsensitiveStore(context);

    await store.add("workspace", { environmentId: "env-1", jobUrl: "job/a/" });
    await store.add("workspace", { environmentId: "env-1", jobUrl: "job/a" });
    await store.add("workspace", { environmentId: "env-2", jobUrl: "job/a/" });
    assert.equal(stored(workspaceState)?.length, 2);

    assert.equal(await store.tracked("workspace", "env-1", "job/a"), true);
    assert.equal(await store.tracked("workspace", "env-1", "job/b"), false);

    assert.equal(await store.removeMany("workspace", "env-1", new Set(["job/a"])), 1);
    assert.deepEqual(stored(workspaceState), [{ environmentId: "env-2", jobUrl: "job/a/" }]);
  });

  it("persists concurrent adds after an earlier mutation rejects", async () => {
    const { store, workspaceState } = await createStore([
      { environmentId: "env-1", jobUrl: "job/a/" }
    ]);

    const results = await Promise.allSettled([
      store.update("workspace", "env-1", "job/a/", () => {
        throw new Error("boom");
      }),
      store.add("workspace", { environmentId: "env-1", jobUrl: "job/b/" }),
      store.add("workspace", { environmentId: "env-1", jobUrl: "job/c/" })
    ]);

    assert.deepEqual(
      results.map((result) => result.status),
      ["rejected", "fulfilled", "fulfilled"]
    );
    assert.deepEqual(
      stored(workspaceState)?.map((entry) => entry.jobUrl),
      ["job/a/", "job/b/", "job/c/"]
    );
  });
});

describe("createSerialTaskQueue", () => {
  it("runs tasks in submission order without overlap", async () => {
    const queue = createSerialTaskQueue();
    const events: string[] = [];
    const task = (name: string, delayMs: number) => async () => {
      events.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`end:${name}`);
      return name;
    };

    const results = await Promise.all([
      queue(task("a", 10)),
      queue(task("b", 0)),
      queue(task("c", 5))
    ]);

    assert.deepEqual(results, ["a", "b", "c"]);
    assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("keeps running later tasks after a task rejects", async () => {
    const queue = createSerialTaskQueue();
    const failed = queue(async () => {
      throw new Error("first failed");
    });
    const next = queue(async () => "second");

    await assert.rejects(failed, /first failed/);
    assert.equal(await next, "second");
  });
});
