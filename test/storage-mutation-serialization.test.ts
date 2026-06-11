import assert from "node:assert/strict";
import Module = require("node:module");
import { describe, it } from "node:test";
import type * as vscode from "vscode";
import { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

class TestEventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();

  readonly event = (listener: (event: T) => void): { dispose(): void } => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => {
  if (request === "vscode") {
    return { EventEmitter: TestEventEmitter };
  }
  return originalLoad(request, parent, isMain);
};

const { JenkinsEnvironmentStore } = require("../src/storage/JenkinsEnvironmentStore") as {
  JenkinsEnvironmentStore: EnvironmentStoreConstructor;
};

moduleWithLoad._load = originalLoad;

interface EnvironmentStoreConstructor {
  new (context: unknown): EnvironmentStoreHarness;
}

interface EnvironmentStoreHarness {
  addEnvironment(
    scope: "workspace" | "global",
    environment: { id: string; url: string },
    token?: string
  ): Promise<void>;
  getEnvironments(scope: "workspace" | "global"): Promise<Array<{ id: string; url: string }>>;
}

class AsyncMemento {
  private readonly storage = new Map<string, unknown>();
  failNextUpdate = false;

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    // Yield before persisting so unserialized read-modify-write callers interleave.
    await new Promise((resolve) => setImmediate(resolve));
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error("update failed");
    }
    this.storage.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.storage.keys()];
  }
}

function createContext(): { context: vscode.ExtensionContext; workspaceState: AsyncMemento } {
  const workspaceState = new AsyncMemento();
  const context = {
    workspaceState,
    globalState: new AsyncMemento(),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined
    }
  } as unknown as vscode.ExtensionContext;
  return { context, workspaceState };
}

describe("scoped job store mutation serialization", () => {
  it("retains both entries when two adds run concurrently", async () => {
    const { context } = createContext();
    const store = new JenkinsWatchStore(context);

    await Promise.all([
      store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/a/" }),
      store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/b/" })
    ]);

    const watched = await store.listWatchedJobs();
    assert.deepEqual(watched.map((entry) => entry.jobUrl).sort(), ["job/a/", "job/b/"]);
  });

  it("retains a status update racing a concurrent add", async () => {
    const { context } = createContext();
    const store = new JenkinsWatchStore(context);
    await store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/a/" });

    await Promise.all([
      store.updateWatchStatus("workspace", "env-1", "job/a/", { lastStatus: "failure" }),
      store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/b/" })
    ]);

    const watched = await store.listWatchedJobs();
    assert.equal(watched.length, 2);
    assert.equal(watched.find((entry) => entry.jobUrl === "job/a/")?.lastStatus, "failure");
  });

  it("leaves persisted state untouched when the memento update fails", async () => {
    const { context, workspaceState } = createContext();
    const store = new JenkinsWatchStore(context);
    await store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/a/" });

    workspaceState.failNextUpdate = true;
    await assert.rejects(store.addWatch("workspace", { environmentId: "env-1", jobUrl: "job/b/" }));

    const watched = await store.listWatchedJobs();
    assert.deepEqual(
      watched.map((entry) => entry.jobUrl),
      ["job/a/"]
    );
  });
});

describe("JenkinsEnvironmentStore mutation serialization", () => {
  it("retains both environments when two adds run concurrently", async () => {
    const { context } = createContext();
    const store = new JenkinsEnvironmentStore(context);

    await Promise.all([
      store.addEnvironment("workspace", { id: "env-1", url: "https://a.example" }),
      store.addEnvironment("workspace", { id: "env-2", url: "https://b.example" })
    ]);

    const environments = await store.getEnvironments("workspace");
    assert.deepEqual(environments.map((environment) => environment.id).sort(), ["env-1", "env-2"]);
  });
});
