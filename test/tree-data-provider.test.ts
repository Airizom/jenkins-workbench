import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

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
  static readonly File = new TestThemeIcon("file");
  static readonly Folder = new TestThemeIcon("folder");

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
  ...createEventEmitterVscodeMock(),
  TreeItem: TestTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: TestThemeIcon,
  ThemeColor: TestThemeColor,
  MarkdownString: TestMarkdownString,
  Uri: {
    parse: (value: string) => ({ toString: () => value }),
    from: (components: { scheme: string; path: string }) => ({
      ...components,
      toString: () => `${components.scheme}:${components.path}`
    })
  },
  window: { setStatusBarMessage: () => ({ dispose: () => undefined }) }
};

interface EnvironmentRef {
  environmentId: string;
  scope: "workspace";
  url: string;
}

interface ProviderHarness {
  onDidChangeTreeData(listener: (element: unknown) => void): { dispose(): void };
  onDidChangeSummary(listener: (summary: TreeViewSummaryStub) => void): { dispose(): void };
  getChildren(element?: unknown): Promise<unknown[]>;
  getParent(element: unknown): unknown;
  refreshViewOnly(): void;
  refreshQueueOnly(environment: EnvironmentRef): void;
  refreshActivity(environment: EnvironmentRef): void;
  invalidateBuildArtifacts(request: {
    environment: EnvironmentRef;
    buildUrl: string;
    refreshTree?: boolean;
  }): void;
  fullEnvironmentRefresh(request?: {
    environmentId?: string;
    trigger?: "manual" | "system";
  }): boolean;
  resolveJobElement(environment: EnvironmentRef, entry: JobSearchEntry): Promise<unknown>;
  dispose(): void;
}

interface ProviderConstructor {
  new (...args: unknown[]): ProviderHarness;
}

vi.doMock("vscode", () => vscodeShim);
const { JenkinsWorkbenchTreeDataProvider } = (await import(
  "../src/tree/TreeDataProvider"
)) as unknown as {
  JenkinsWorkbenchTreeDataProvider: ProviderConstructor;
};

interface TreeItemView {
  id?: string;
  label?: string;
  command?: { command: string; arguments?: unknown[] };
  contextValue?: string;
  kind?: string;
  jobUrl?: string;
  folderUrl?: string;
  description?: string;
  relativePath?: string;
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

interface QueueItemStub {
  id: number;
  name: string;
  position: number;
}

interface NodeInfoStub {
  displayName: string;
  offline: boolean;
}

interface BuildInfoStub {
  number: number;
  url: string;
  building: boolean;
  result: string;
  timestamp: number;
  duration: number;
}

interface ArtifactStub {
  fileName: string;
  relativePath: string;
}

interface TreeViewSummaryStub {
  running: number;
  queue: number;
  watchErrors: number;
  hasData: boolean;
}

interface ProviderFixture {
  provider: ProviderHarness;
  environmentRef: EnvironmentRef;
  cacheClearsForEnvironment: number;
  queueLoads: number;
  queueResponses: QueueItemStub[][];
  queueDelays: number[];
  nodeLoads: number;
  nodeResponses: NodeInfoStub[][];
  nodeDelays: number[];
  artifactLoads: number;
  artifactResponses: ArtifactStub[][];
  artifactDelays: number[];
  builds: BuildInfoStub[];
  jobCollections: Map<string, JobInfoStub[]>;
  jobCollectionDelays: Map<string, number>;
  filterJobs: (jobs: JobInfoStub[]) => JobInfoStub[];
  jobFilterActive: boolean;
  nodeError?: unknown;
  events: unknown[];
  summaryEvents: TreeViewSummaryStub[];
}

interface ProviderFixtureOptions {
  replayPendingInputSummaryOnSubscribe?: boolean;
}

function createProviderFixture(options: ProviderFixtureOptions = {}): ProviderFixture {
  const environmentRef: EnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };

  const fixture: ProviderFixture = {
    provider: undefined as unknown as ProviderHarness,
    environmentRef,
    cacheClearsForEnvironment: 0,
    queueLoads: 0,
    queueResponses: [],
    queueDelays: [],
    nodeLoads: 0,
    nodeResponses: [],
    nodeDelays: [],
    artifactLoads: 0,
    artifactResponses: [],
    artifactDelays: [],
    builds: [],
    jobCollections: new Map(),
    jobCollectionDelays: new Map(),
    filterJobs: (jobs) => jobs,
    jobFilterActive: false,
    events: [],
    summaryEvents: []
  };

  const store = {
    listEnvironmentsWithScope: async () => [
      { id: "env-1", scope: "workspace" as const, url: "https://jenkins.example/" }
    ]
  };
  const dataService = {
    clearCache: () => undefined,
    clearCacheForEnvironment: () => {
      fixture.cacheClearsForEnvironment += 1;
    },
    getJobCollection: async (_environment: unknown, request: { folderUrl?: string }) => {
      const folderUrl = request.folderUrl ?? "";
      const response = fixture.jobCollections.get(folderUrl) ?? [];
      const responseDelay = fixture.jobCollectionDelays.get(folderUrl) ?? 2;
      await delay(responseDelay);
      return response;
    },
    getQueueItems: async () => {
      const loadIndex = fixture.queueLoads;
      fixture.queueLoads += 1;
      await delay(fixture.queueDelays[loadIndex] ?? 2);
      return fixture.queueResponses[loadIndex] ?? [];
    },
    getViewsForEnvironment: async () => [],
    getNodes: async () => {
      const loadIndex = fixture.nodeLoads;
      fixture.nodeLoads += 1;
      await delay(fixture.nodeDelays[loadIndex] ?? 2);
      if (fixture.nodeError) {
        throw fixture.nodeError;
      }
      return fixture.nodeResponses[loadIndex] ?? [];
    },
    getBuildsForJob: async () => fixture.builds,
    getBuildArtifacts: async () => {
      const loadIndex = fixture.artifactLoads;
      fixture.artifactLoads += 1;
      await delay(fixture.artifactDelays[loadIndex] ?? 2);
      return fixture.artifactResponses[loadIndex] ?? [];
    }
  };
  const watchStore = {
    getWatchedJobUrls: async () => new Set<string>()
  };
  const pinStore = {
    listPinnedJobsForEnvironment: async () => []
  };
  const treeFilter = {
    getBranchFilter: () => undefined,
    isJobFilterActive: () => fixture.jobFilterActive,
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
    onSummaryChange: (
      listener: (change: {
        environment: EnvironmentRef;
        buildUrl: string;
        summary: { awaitingInput: boolean; count: number; fetchedAt: number };
      }) => void
    ) => {
      if (options.replayPendingInputSummaryOnSubscribe) {
        listener({
          environment: environmentRef,
          buildUrl: "https://jenkins.example/job/demo/1/",
          summary: { awaitingInput: true, count: 1, fetchedAt: Date.now() }
        });
      }
      return () => undefined;
    }
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
  fixture.provider.onDidChangeSummary((summary) => fixture.summaryEvents.push(summary));
  return fixture;
}

async function expandToInstance(fixture: ProviderFixture): Promise<unknown> {
  const instances = await fixture.provider.getChildren();
  return instances[0];
}

async function expandToFolders(fixture: ProviderFixture): Promise<{
  instance: unknown;
  queueFolder: unknown;
  activityFolder: unknown;
  jobsFolder: unknown;
  nodesFolder: unknown;
}> {
  const instance = await expandToInstance(fixture);
  const folders = await fixture.provider.getChildren(instance);
  return {
    instance,
    queueFolder: folders.find((item) => asItem(item).contextValue === "queueFolder"),
    activityFolder: folders.find((item) => asItem(item).contextValue === "activity"),
    jobsFolder: folders.find((item) => asItem(item).contextValue === "jobs"),
    nodesFolder: folders.find((item) => asItem(item).contextValue === "nodes")
  };
}

describe("JenkinsWorkbenchTreeDataProvider queue and activity refresh", () => {
  it("constructs when pending input summary listeners replay immediately", () => {
    const fixture = createProviderFixture({ replayPendingInputSummaryOnSubscribe: true });

    fixture.provider.dispose();
  });

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

  it("drops stale folder instances when root instances are replaced", async () => {
    const fixture = createProviderFixture();
    const { queueFolder } = await expandToFolders(fixture);
    assert.ok(queueFolder);

    const replacementInstances = await fixture.provider.getChildren();
    const replacementInstance = replacementInstances[0];
    fixture.events.length = 0;

    fixture.provider.refreshQueueOnly(fixture.environmentRef);

    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0], replacementInstance);
    assert.notEqual(fixture.events[0], queueFolder);
    fixture.provider.dispose();
  });

  it("rate-limits environment-scoped manual refreshes but not system refreshes", () => {
    const fixture = createProviderFixture();

    assert.equal(
      fixture.provider.fullEnvironmentRefresh({
        environmentId: fixture.environmentRef.environmentId,
        trigger: "manual"
      }),
      true
    );
    assert.equal(
      fixture.provider.fullEnvironmentRefresh({
        environmentId: fixture.environmentRef.environmentId,
        trigger: "manual"
      }),
      false
    );
    assert.equal(
      fixture.provider.fullEnvironmentRefresh({
        environmentId: fixture.environmentRef.environmentId,
        trigger: "system"
      }),
      true
    );
    assert.equal(fixture.cacheClearsForEnvironment, 2);
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

  it("does not let a stale queue load overwrite the current queue summary", async () => {
    const fixture = createProviderFixture();
    fixture.queueResponses.push(
      [
        { id: 1, name: "first", position: 1 },
        { id: 2, name: "second", position: 2 }
      ],
      [{ id: 3, name: "current", position: 1 }]
    );
    fixture.queueDelays.push(30, 2);
    const { queueFolder } = await expandToFolders(fixture);

    await fixture.provider.getChildren(queueFolder);
    fixture.provider.refreshQueueOnly(fixture.environmentRef);
    await fixture.provider.getChildren(queueFolder);
    await delay(50);

    assert.equal(fixture.summaryEvents.at(-1)?.queue, 1);
    fixture.provider.dispose();
  });

  it("does not let a stale root jobs load overwrite the current jobs summary", async () => {
    const fixture = createProviderFixture();
    fixture.jobCollections.set("", [
      {
        name: "stale-one",
        url: "https://jenkins.example/job/stale-one/",
        kind: "job",
        color: "blue_anime"
      },
      {
        name: "stale-two",
        url: "https://jenkins.example/job/stale-two/",
        kind: "job",
        color: "blue_anime"
      }
    ]);
    fixture.jobCollectionDelays.set("", 30);
    const { jobsFolder } = await expandToFolders(fixture);

    await fixture.provider.getChildren(jobsFolder);
    fixture.jobCollections.set("", [
      {
        name: "current",
        url: "https://jenkins.example/job/current/",
        kind: "job",
        color: "blue"
      }
    ]);
    fixture.jobCollectionDelays.set("", 2);
    fixture.provider.fullEnvironmentRefresh({
      environmentId: fixture.environmentRef.environmentId,
      trigger: "system"
    });
    const refreshedFolders = await expandToFolders(fixture);
    await fixture.provider.getChildren(refreshedFolders.jobsFolder);
    await delay(50);

    const finalFolders = await expandToFolders(fixture);
    assert.equal(asItem(finalFolders.jobsFolder).description, "1 item");
    fixture.provider.dispose();
  });

  it("does not let a stale nodes load overwrite the current nodes summary", async () => {
    const fixture = createProviderFixture();
    fixture.nodeResponses.push(
      [
        { displayName: "stale-one", offline: true },
        { displayName: "stale-two", offline: true }
      ],
      [{ displayName: "current", offline: false }]
    );
    fixture.nodeDelays.push(30, 2);
    const { nodesFolder } = await expandToFolders(fixture);

    await fixture.provider.getChildren(nodesFolder);
    fixture.provider.fullEnvironmentRefresh({
      environmentId: fixture.environmentRef.environmentId,
      trigger: "system"
    });
    const refreshedFolders = await expandToFolders(fixture);
    await fixture.provider.getChildren(refreshedFolders.nodesFolder);
    await delay(50);

    const finalFolders = await expandToFolders(fixture);
    assert.equal(asItem(finalFolders.nodesFolder).description, "1 online");
    fixture.provider.dispose();
  });

  it("does not let a stale artifact load repopulate the artifact cache", async () => {
    const fixture = createProviderFixture();
    const jobUrl = "https://jenkins.example/job/demo/";
    const buildUrl = `${jobUrl}1/`;
    fixture.jobCollections.set("", [{ name: "demo", url: jobUrl, kind: "job", color: "blue" }]);
    fixture.builds = [
      {
        number: 1,
        url: buildUrl,
        building: false,
        result: "SUCCESS",
        timestamp: Date.now(),
        duration: 1000
      }
    ];
    fixture.artifactResponses.push(
      [
        { fileName: "stale-one.txt", relativePath: "stale-one.txt" },
        { fileName: "stale-two.txt", relativePath: "stale-two.txt" }
      ],
      [{ fileName: "current.txt", relativePath: "current.txt" }]
    );
    fixture.artifactDelays.push(30, 2);
    const { jobsFolder } = await expandToFolders(fixture);

    await fixture.provider.getChildren(jobsFolder);
    await delay(10);
    const jobs = await fixture.provider.getChildren(jobsFolder);
    const job = jobs.find((item) => asItem(item).contextValue?.startsWith("jobItem"));
    assert.ok(job);

    await fixture.provider.getChildren(job);
    await delay(10);
    const jobChildren = await fixture.provider.getChildren(job);
    const build = jobChildren.find((item) => asItem(item).contextValue === "build");
    assert.ok(build);

    await fixture.provider.getChildren(build);
    fixture.provider.invalidateBuildArtifacts({
      environment: fixture.environmentRef,
      buildUrl,
      refreshTree: false
    });
    await fixture.provider.getChildren(build);
    await delay(50);

    const artifacts = await fixture.provider.getChildren(build);
    assert.equal(fixture.artifactLoads, 2);
    assert.deepEqual(
      artifacts.map((item) => asItem(item).relativePath),
      ["current.txt"]
    );
    fixture.provider.dispose();
  });

  it("invalidates an in-flight build artifact load through the shared path", async () => {
    const fixture = createProviderFixture();
    const jobUrl = "https://jenkins.example/job/demo/";
    const buildUrl = `${jobUrl}1/`;
    fixture.jobCollections.set("", [{ name: "demo", url: jobUrl, kind: "job", color: "blue" }]);
    fixture.builds = [
      {
        number: 1,
        url: buildUrl,
        building: false,
        result: "SUCCESS",
        timestamp: Date.now(),
        duration: 1000
      }
    ];
    fixture.artifactResponses.push(
      [{ fileName: "initial.txt", relativePath: "initial.txt" }],
      [
        { fileName: "stale-one.txt", relativePath: "stale-one.txt" },
        { fileName: "stale-two.txt", relativePath: "stale-two.txt" }
      ],
      [{ fileName: "current.txt", relativePath: "current.txt" }]
    );
    fixture.artifactDelays.push(2, 30, 2);
    const { jobsFolder } = await expandToFolders(fixture);

    await fixture.provider.getChildren(jobsFolder);
    await delay(10);
    const jobs = await fixture.provider.getChildren(jobsFolder);
    const job = jobs.find((item) => asItem(item).contextValue?.startsWith("jobItem"));
    assert.ok(job);

    await fixture.provider.getChildren(job);
    await delay(10);
    const jobChildren = await fixture.provider.getChildren(job);
    const build = jobChildren.find((item) => asItem(item).contextValue === "build");
    assert.ok(build);

    await fixture.provider.getChildren(build);
    await delay(10);
    const initialArtifacts = await fixture.provider.getChildren(build);
    assert.deepEqual(
      initialArtifacts.map((item) => asItem(item).relativePath),
      ["initial.txt"]
    );

    fixture.provider.invalidateBuildArtifacts({
      environment: fixture.environmentRef,
      buildUrl,
      refreshTree: false
    });
    await fixture.provider.getChildren(build);
    fixture.provider.invalidateBuildArtifacts({
      environment: fixture.environmentRef,
      buildUrl,
      refreshTree: false
    });
    await fixture.provider.getChildren(build);
    await delay(50);

    const artifacts = await fixture.provider.getChildren(build);
    assert.equal(fixture.artifactLoads, 3);
    assert.deepEqual(
      artifacts.map((item) => asItem(item).relativePath),
      ["current.txt"]
    );
    fixture.provider.dispose();
  });

  it("preserves loaded summaries during a view-only refresh", async () => {
    const fixture = createProviderFixture();
    fixture.jobCollections.set("", [
      {
        name: "running",
        url: "https://jenkins.example/job/running/",
        kind: "job",
        color: "blue_anime"
      }
    ]);
    fixture.queueResponses.push([{ id: 1, name: "queued", position: 1 }]);
    const { jobsFolder, queueFolder } = await expandToFolders(fixture);

    await Promise.all([
      fixture.provider.getChildren(jobsFolder),
      fixture.provider.getChildren(queueFolder)
    ]);
    await delay(20);
    assert.deepEqual(fixture.summaryEvents.at(-1), {
      running: 1,
      queue: 1,
      watchErrors: 0,
      hasData: true
    });

    fixture.provider.refreshViewOnly();
    const refreshedFolders = await expandToFolders(fixture);

    assert.equal(asItem(refreshedFolders.jobsFolder).description, "1 item • 1 running");
    assert.equal(asItem(refreshedFolders.queueFolder).description, "1 waiting");
    assert.deepEqual(fixture.summaryEvents.at(-1), {
      running: 1,
      queue: 1,
      watchErrors: 0,
      hasData: true
    });
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

  it("preserves rendered folder notification targets during internal traversal", async () => {
    const fixture = createProviderFixture();
    const { queueFolder } = await expandToFolders(fixture);

    const resolved = await fixture.provider.resolveJobElement(fixture.environmentRef, entry);
    assert.equal(resolved, undefined);
    fixture.events.length = 0;

    fixture.provider.refreshQueueOnly(fixture.environmentRef);

    assert.deepEqual(fixture.events, [queueFolder]);
    fixture.provider.dispose();
  });

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

describe("JenkinsWorkbenchTreeDataProvider presentation", () => {
  async function loadChildren(fixture: ProviderFixture, element: unknown): Promise<unknown[]> {
    await fixture.provider.getChildren(element);
    await delay(20);
    return fixture.provider.getChildren(element);
  }

  it("lists environments directly at the root", async () => {
    const fixture = createProviderFixture();
    const roots = await fixture.provider.getChildren();
    assert.equal(roots.length, 1);
    assert.equal(asItem(roots[0]).contextValue, "environment");
    fixture.provider.dispose();
  });

  it("flags the environment and offers a retry when a load fails to authenticate", async () => {
    const fixture = createProviderFixture();
    fixture.nodeError = new JenkinsRequestError("Unauthorized", 401);
    const { nodesFolder } = await expandToFolders(fixture);

    const children = await loadChildren(fixture, nodesFolder);
    const placeholder = asItem(children[0]);
    assert.equal(placeholder.kind, "error");
    assert.equal(placeholder.command?.command, "jenkinsWorkbench.refresh");
    const retryTarget = placeholder.command?.arguments?.[0] as EnvironmentRef | undefined;
    assert.equal(retryTarget?.environmentId, fixture.environmentRef.environmentId);

    await Promise.resolve();
    assert.ok(fixture.events.includes(undefined));
    const [instance] = await fixture.provider.getChildren();
    assert.equal(asItem(instance).description, "Sign-in failed • Workspace");

    fixture.nodeError = undefined;
    fixture.provider.fullEnvironmentRefresh({
      environmentId: fixture.environmentRef.environmentId,
      trigger: "system"
    });
    const [refreshed] = await fixture.provider.getChildren();
    assert.equal(asItem(refreshed).description, "Workspace");
    fixture.provider.dispose();
  });

  it("lists builds before the workspace and links older builds to Job History", async () => {
    const fixture = createProviderFixture();
    const jobUrl = "https://jenkins.example/job/demo/";
    fixture.jobCollections.set("", [{ name: "demo", url: jobUrl, kind: "job", color: "blue" }]);
    fixture.builds = Array.from({ length: 20 }, (_, index) => ({
      number: 20 - index,
      url: `${jobUrl}${20 - index}/`,
      building: false,
      result: "SUCCESS",
      timestamp: Date.now(),
      duration: 1000
    }));
    const { jobsFolder } = await expandToFolders(fixture);
    const [job] = await loadChildren(fixture, jobsFolder);

    const children = await loadChildren(fixture, job);
    assert.equal(asItem(children[0]).contextValue, "build");
    const olderBuilds = asItem(children.at(-2));
    assert.equal(olderBuilds.command?.command, "jenkinsWorkbench.openJobHistory");
    assert.equal(olderBuilds.command?.arguments?.[0], job);
    assert.equal(asItem(children.at(-1)).contextValue, "workspaceRoot");
    fixture.provider.dispose();
  });

  it("offers to show all jobs when the job filter hides everything", async () => {
    const fixture = createProviderFixture();
    fixture.jobCollections.set("", [
      { name: "demo", url: "https://jenkins.example/job/demo/", kind: "job", color: "blue" }
    ]);
    fixture.filterJobs = () => [];
    fixture.jobFilterActive = true;
    const { jobsFolder } = await expandToFolders(fixture);

    const [placeholder] = await loadChildren(fixture, jobsFolder);
    assert.equal(asItem(placeholder).command?.command, "jenkinsWorkbench.filterJobsAll");
    fixture.provider.dispose();
  });
});
