import assert from "node:assert/strict";
import Module = require("node:module");
import { describe, it } from "node:test";
import type { JobSearchEntry } from "../src/jenkins/JenkinsDataService";

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

class TestTreeItem {
  id?: string;
  contextValue?: string;
  description?: unknown;
  tooltip?: unknown;
  iconPath?: unknown;
  command?: unknown;

  constructor(
    public label: unknown,
    public collapsibleState?: unknown
  ) {}
}

class TestThemeIcon {
  constructor(
    public readonly iconId: string,
    public readonly color?: unknown
  ) {}
}

class TestThemeColor {
  constructor(public readonly colorId: string) {}
}

class TestMarkdownString {
  value = "";
  isTrusted: unknown;
  supportThemeIcons: unknown;
  supportHtml: unknown;

  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }

  appendText(text: string): this {
    this.value += text;
    return this;
  }

  appendCodeblock(text: string): this {
    this.value += text;
    return this;
  }
}

const vscodeShim = {
  EventEmitter: TestEventEmitter,
  TreeItem: TestTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: TestThemeIcon,
  ThemeColor: TestThemeColor,
  MarkdownString: TestMarkdownString,
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  window: { setStatusBarMessage: () => ({ dispose: () => undefined }) }
};

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => {
  if (request === "vscode") {
    return vscodeShim;
  }
  return originalLoad(request, parent, isMain);
};

interface EnvironmentRef {
  environmentId: string;
  scope: "workspace";
  url: string;
}

interface ProviderHarness {
  onDidChangeTreeData(listener: (element: unknown) => void): { dispose(): void };
  getChildren(element?: unknown): Promise<unknown[]>;
  getParent(element: unknown): unknown;
  refreshQueueOnly(environment: EnvironmentRef): void;
  refreshActivity(environment: EnvironmentRef): void;
  resolveJobElement(environment: EnvironmentRef, entry: JobSearchEntry): Promise<unknown>;
  dispose(): void;
}

interface ProviderConstructor {
  new (...args: unknown[]): ProviderHarness;
}

const { JenkinsWorkbenchTreeDataProvider } = require("../src/tree/TreeDataProvider") as {
  JenkinsWorkbenchTreeDataProvider: ProviderConstructor;
};

moduleWithLoad._load = originalLoad;

interface TreeItemView {
  id?: string;
  contextValue?: string;
  kind?: string;
  jobUrl?: string;
  folderUrl?: string;
}

function asItem(value: unknown): TreeItemView {
  return value as TreeItemView;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface JobInfoStub {
  name: string;
  url: string;
  kind: string;
  color?: string;
}

interface ProviderFixture {
  provider: ProviderHarness;
  environmentRef: EnvironmentRef;
  queueLoads: number;
  jobCollections: Map<string, JobInfoStub[]>;
  jobCollectionDelays: Map<string, number>;
  filterJobs: (jobs: JobInfoStub[]) => JobInfoStub[];
  events: unknown[];
}

function createProviderFixture(): ProviderFixture {
  const environmentRef: EnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };

  const fixture: ProviderFixture = {
    provider: undefined as unknown as ProviderHarness,
    environmentRef,
    queueLoads: 0,
    jobCollections: new Map(),
    jobCollectionDelays: new Map(),
    filterJobs: (jobs) => jobs,
    events: []
  };

  const store = {
    listEnvironmentsWithScope: async () => [
      { id: "env-1", scope: "workspace" as const, url: "https://jenkins.example/" }
    ]
  };
  const dataService = {
    clearCache: () => undefined,
    clearCacheForEnvironment: () => undefined,
    getJobCollection: async (_environment: unknown, request: { folderUrl?: string }) => {
      const folderUrl = request.folderUrl ?? "";
      await delay(fixture.jobCollectionDelays.get(folderUrl) ?? 2);
      return fixture.jobCollections.get(folderUrl) ?? [];
    },
    getQueueItems: async () => {
      fixture.queueLoads += 1;
      await delay(2);
      return [];
    },
    getViewsForEnvironment: async () => [],
    getNodes: async () => []
  };
  const watchStore = {
    getWatchedJobUrls: async () => new Set<string>()
  };
  const pinStore = {
    listPinnedJobsForEnvironment: async () => []
  };
  const treeFilter = {
    getBranchFilter: () => undefined,
    filterJobs: (_environment: unknown, jobs: JobInfoStub[]) => fixture.filterJobs(jobs)
  };
  const activityOptions = {
    maxItemsPerGroup: 10,
    collection: {
      maxScanResults: 10,
      jobSearchBatchSize: 10,
      pendingInputCandidateLimit: 10,
      pendingInputLookupConcurrency: 1,
      pendingInputBuildLookupLimit: 10,
      refreshMinIntervalMs: 1000
    }
  };
  const pendingInputCoordinator = {
    onSummaryChange: () => () => undefined
  };

  fixture.provider = new JenkinsWorkbenchTreeDataProvider(
    store,
    dataService,
    watchStore,
    pinStore,
    treeFilter,
    {},
    {},
    {},
    activityOptions,
    pendingInputCoordinator
  );
  fixture.provider.onDidChangeTreeData((element) => fixture.events.push(element));
  return fixture;
}

async function expandToInstance(fixture: ProviderFixture): Promise<unknown> {
  const rootItems = await fixture.provider.getChildren();
  const instances = await fixture.provider.getChildren(rootItems[0]);
  return instances[0];
}

async function expandToFolders(fixture: ProviderFixture): Promise<{
  instance: unknown;
  queueFolder: unknown;
  activityFolder: unknown;
  jobsFolder: unknown;
}> {
  const instance = await expandToInstance(fixture);
  const folders = await fixture.provider.getChildren(instance);
  return {
    instance,
    queueFolder: folders.find((item) => asItem(item).contextValue === "queueFolder"),
    activityFolder: folders.find((item) => asItem(item).contextValue === "activity"),
    jobsFolder: folders.find((item) => asItem(item).contextValue === "jobs")
  };
}

describe("JenkinsWorkbenchTreeDataProvider queue and activity refresh", () => {
  it("fires the cached queue folder instance when refreshing the queue", async () => {
    const fixture = createProviderFixture();
    const { queueFolder } = await expandToFolders(fixture);
    assert.ok(queueFolder);
    fixture.events.length = 0;

    fixture.provider.refreshQueueOnly(fixture.environmentRef);

    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0], queueFolder);
    fixture.provider.dispose();
  });

  it("fires the cached activity folder instance when refreshing activity", async () => {
    const fixture = createProviderFixture();
    const { activityFolder } = await expandToFolders(fixture);
    assert.ok(activityFolder);
    fixture.events.length = 0;

    fixture.provider.refreshActivity(fixture.environmentRef);

    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0], activityFolder);
    fixture.provider.dispose();
  });

  it("falls back to the cached environment instance when the folder was never rendered", async () => {
    const fixture = createProviderFixture();
    const instance = await expandToInstance(fixture);
    fixture.events.length = 0;

    fixture.provider.refreshQueueOnly(fixture.environmentRef);

    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0], instance);
    fixture.provider.dispose();
  });

  it("falls back to a full refresh when nothing was rendered", async () => {
    const fixture = createProviderFixture();

    fixture.provider.refreshQueueOnly(fixture.environmentRef);

    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0], undefined);
    fixture.provider.dispose();
  });

  it("re-triggers a queue load after a refresh clears an in-flight load", async () => {
    const fixture = createProviderFixture();
    const { queueFolder } = await expandToFolders(fixture);

    const first = await fixture.provider.getChildren(queueFolder);
    assert.equal(asItem(first[0]).kind, "loading");

    // Clearing during the in-flight load discards its result; the fired cached
    // instance lets the host re-request children, which must start a new load.
    fixture.provider.refreshQueueOnly(fixture.environmentRef);
    const second = await fixture.provider.getChildren(queueFolder);
    assert.equal(asItem(second[0]).kind, "loading");

    await delay(30);
    const third = await fixture.provider.getChildren(queueFolder);
    assert.equal(asItem(third[0]).kind, "empty");
    assert.equal(fixture.queueLoads, 2);
    fixture.provider.dispose();
  });
});

describe("JenkinsWorkbenchTreeDataProvider reveal resolution", () => {
  const folderUrl = "https://jenkins.example/job/folder/";
  const jobUrl = "https://jenkins.example/job/folder/job/demo/";
  const entry: JobSearchEntry = {
    name: "demo",
    url: jobUrl,
    kind: "job",
    fullName: "folder/demo",
    path: [
      { name: "folder", url: folderUrl, kind: "folder" },
      { name: "demo", url: jobUrl, kind: "job" }
    ]
  };

  function seedJobCollections(fixture: ProviderFixture): void {
    fixture.jobCollections.set("", [{ name: "folder", url: folderUrl, kind: "folder" }]);
    fixture.jobCollections.set(folderUrl, [
      { name: "demo", url: jobUrl, kind: "job", color: "blue" }
    ]);
  }

  it("resolves a nested job on a cold tree and leaves each level cached", async () => {
    const fixture = createProviderFixture();
    seedJobCollections(fixture);

    const element = await fixture.provider.resolveJobElement(fixture.environmentRef, entry);

    assert.ok(element);
    assert.equal(asItem(element).jobUrl, jobUrl);

    // The reveal that follows re-resolves through getChildren; each job-collection
    // level must now be cached so it returns the same instances, not placeholders.
    const folderItem = fixture.provider.getParent(element);
    assert.equal(asItem(folderItem).folderUrl, folderUrl);
    const folderChildren = await fixture.provider.getChildren(folderItem);
    assert.ok(folderChildren.includes(element));

    const jobsFolder = fixture.provider.getParent(folderItem);
    assert.equal(asItem(jobsFolder).contextValue, "jobs");
    const jobsChildren = await fixture.provider.getChildren(jobsFolder);
    assert.ok(jobsChildren.includes(folderItem));
    fixture.provider.dispose();
  });

  it("keeps waiting when cold reveal children are still loading after a poll timeout", async () => {
    const fixture = createProviderFixture();
    seedJobCollections(fixture);
    fixture.jobCollectionDelays.set(folderUrl, 4100);

    const element = await fixture.provider.resolveJobElement(fixture.environmentRef, entry);

    assert.ok(element);
    assert.equal(asItem(element).jobUrl, jobUrl);
    fixture.provider.dispose();
  });

  it("returns undefined when the target job is hidden by an active filter", async () => {
    const fixture = createProviderFixture();
    seedJobCollections(fixture);
    fixture.filterJobs = (jobs) =>
      jobs.filter((job) => job.kind === "folder" || job.kind === "multibranch");

    const element = await fixture.provider.resolveJobElement(fixture.environmentRef, entry);

    assert.equal(element, undefined);
    fixture.provider.dispose();
  });

  it("returns undefined for an unknown folder path segment", async () => {
    const fixture = createProviderFixture();
    fixture.jobCollections.set("", [
      { name: "other", url: "https://jenkins.example/job/other/", kind: "folder" }
    ]);

    const element = await fixture.provider.resolveJobElement(fixture.environmentRef, entry);

    assert.equal(element, undefined);
    fixture.provider.dispose();
  });
});
