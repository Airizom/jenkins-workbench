import assert from "node:assert/strict";
import Module = require("node:module");
import { beforeEach, describe, it } from "node:test";
import type {
  CurrentBranchPullRequestJobMatcher,
  CurrentBranchPullRequestJobRef
} from "../src/currentBranch/CurrentBranchPullRequestJobMatcher";
import type { CurrentBranchPullRequestResolution } from "../src/currentBranch/CurrentBranchPullRequestService";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchRepositoryContext
} from "../src/currentBranch/CurrentBranchTypes";
import type { GitApi, GitRepository } from "../src/git/GitExtensionApi";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

class TestUri {
  readonly scheme = "file";
  readonly authority = "";

  private constructor(readonly fsPath: string) {}

  static file(fsPath: string): TestUri {
    return new TestUri(fsPath);
  }

  toString(): string {
    return `file://${this.fsPath}`;
  }
}

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

const vscodeMock = {
  EventEmitter: TestEventEmitter,
  window: {
    activeTextEditor: undefined as { document: { uri: TestUri } } | undefined,
    onDidChangeActiveTextEditor: () => ({ dispose: () => undefined })
  },
  workspace: {
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined })
  },
  Uri: TestUri
};

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad(request, parent, isMain);
};

const { CurrentBranchRepositoryResolver } =
  require("../src/currentBranch/CurrentBranchRepositoryResolver") as typeof import(
    "../src/currentBranch/CurrentBranchRepositoryResolver"
  );
const { CurrentBranchTargetResolver } =
  require("../src/currentBranch/CurrentBranchTargetResolver") as typeof import(
    "../src/currentBranch/CurrentBranchTargetResolver"
  );
const { CurrentBranchStatusResolver } =
  require("../src/currentBranch/CurrentBranchStatusResolver") as typeof import(
    "../src/currentBranch/CurrentBranchStatusResolver"
  );

moduleWithLoad._load = originalLoad;

const noopEvent = (() => ({
  dispose: () => undefined
})) as unknown as GitApi["onDidOpenRepository"];

beforeEach(() => {
  vscodeMock.window.activeTextEditor = undefined;
});

describe("CurrentBranchRepositoryResolver", () => {
  it("prefers the deepest repository containing the active editor over selected UI state", () => {
    const parent = createGitRepository("/workspace/app", { selected: true });
    const nested = createGitRepository("/workspace/app/packages/service");
    const resolver = createRepositoryResolver([parent, nested]);
    vscodeMock.window.activeTextEditor = {
      document: { uri: TestUri.file("/workspace/app/packages/service/src/index.ts") }
    };

    const resolved = resolver.resolveActiveRepository();

    assert.equal(resolved?.repositoryUriString, nested.rootUri.toString());
    resolver.dispose();
  });

  it("returns undefined for detached active files and ambiguous unselected repositories", () => {
    const resolver = createRepositoryResolver([
      createGitRepository("/workspace/app-a"),
      createGitRepository("/workspace/app-b")
    ]);
    vscodeMock.window.activeTextEditor = {
      document: { uri: TestUri.file("/tmp/outside.ts") }
    };

    assert.equal(resolver.resolveActiveRepository(), undefined);
    resolver.dispose();
  });
});

describe("CurrentBranchTargetResolver", () => {
  it("selects a matching pull request job before branch fallback", async () => {
    const fixture = createTargetFixture({
      pullRequestResolution: {
        kind: "pullRequest",
        number: 42,
        title: "Add deployment",
        url: "https://github.example/pull/42",
        headBranch: "feature/deploy"
      },
      jobs: [
        { name: "feature%2Fdeploy", url: "job/main/job/feature%2Fdeploy/", color: "blue" },
        { name: "PR-42", url: "job/main/job/PR-42/", color: "yellow" }
      ],
      matcher: (jobs, pullRequestContext) =>
        pullRequestContext.kind === "pullRequest"
          ? { job: jobs[1], pullRequest: pullRequestContext }
          : undefined
    });

    const resolution = await fixture.resolver.resolve(fixture.localState, {});

    assert.equal(resolution.kind, "selected");
    assert.equal(resolution.target.selectedTarget.kind, "pullRequest");
    assert.equal(resolution.target.selectedTarget.jobUrl, "job/main/job/PR-42/");
    assert.deepEqual(resolution.target.selectedTarget.pullRequest, {
      number: 42,
      title: "Add deployment",
      url: "https://github.example/pull/42",
      headBranch: "feature/deploy"
    });
  });

  it("matches URL-encoded Jenkins branch names and reports missing branches", async () => {
    const matched = createTargetFixture({
      pullRequestResolution: { kind: "none" },
      jobs: [{ name: "feature%2Fdeploy", url: "job/main/job/feature%2Fdeploy/" }]
    });

    const selected = await matched.resolver.resolve(matched.localState, {});

    assert.equal(selected.kind, "selected");
    assert.equal(selected.target.selectedTarget.kind, "branch");
    assert.equal(selected.target.selectedTarget.jobName, "feature/deploy");

    const missing = createTargetFixture({
      pullRequestResolution: { kind: "none" },
      jobs: []
    });

    const missingResolution = await missing.resolver.resolve(missing.localState, {});

    assert.equal(missingResolution.kind, "branchMissing");
    assert.equal(missingResolution.branchName, "feature/deploy");
  });

  it("uses short-lived caches unless force refresh is requested", async () => {
    const jobsByCall = [
      [{ name: "feature%2Fdeploy", url: "job/main/job/feature%2Fdeploy/", color: "blue" }],
      [{ name: "feature%2Fdeploy", url: "job/main/job/feature%2Fdeploy/", color: "red" }]
    ];
    const fixture = createTargetFixture({
      pullRequestResolution: { kind: "none" },
      get jobs() {
        return jobsByCall[Math.min(fixture.jobCalls, jobsByCall.length - 1)];
      }
    });

    const first = await fixture.resolver.resolve(fixture.localState, {});
    const second = await fixture.resolver.resolve(fixture.localState, {});
    const refreshed = await fixture.resolver.resolve(fixture.localState, { force: true });

    assert.equal(first.kind, "selected");
    assert.equal(second.kind, "selected");
    assert.equal(refreshed.kind, "selected");
    assert.equal(first.target.selectedTarget.jobColor, "blue");
    assert.equal(second.target.selectedTarget.jobColor, "blue");
    assert.equal(refreshed.target.selectedTarget.jobColor, "red");
    assert.equal(fixture.pullRequestCalls, 2);
    assert.equal(fixture.jobCalls, 2);
  });
});

describe("CurrentBranchStatusResolver", () => {
  it("preserves selected target context when hydration fails", async () => {
    const selectedTarget = {
      kind: "branch" as const,
      jobName: "feature/deploy",
      jobUrl: "job/main/job/feature%2Fdeploy/",
      jobColor: "blue"
    };
    const localState = createLinkedContext();
    const targetResolver = {
      dispose: () => undefined,
      resolve: async () => ({
        kind: "selected" as const,
        cacheKey: "target:feature/deploy",
        target: {
          branchName: "feature/deploy",
          link: localState.link,
          environment: localState.environment,
          selectedTarget
        }
      })
    };
    const dataService = {
      getJob: async () => {
        throw new Error("Jenkins unavailable");
      }
    } as unknown as JenkinsDataService;
    const resolver = new CurrentBranchStatusResolver(
      dataService,
      targetResolver as unknown as InstanceType<typeof CurrentBranchTargetResolver>
    );

    const state = await resolver.resolve(localState, {});

    assert.equal(state.kind, "requestFailed");
    assert.equal(state.branchName, "feature/deploy");
    assert.equal(
      state.message,
      'Unable to load Jenkins branch job "feature/deploy": Jenkins unavailable'
    );
    assert.deepEqual(state.selectedTarget, selectedTarget);
    assert.equal(state.repository.repositoryUriString, localState.repository.repositoryUriString);
  });

  it("caches hydrated remote state and bypasses the cache on force refresh", async () => {
    const localState = createLinkedContext();
    let jobCalls = 0;
    const targetResolver = {
      dispose: () => undefined,
      resolve: async () => ({
        kind: "selected" as const,
        cacheKey: "target:feature/deploy",
        target: {
          branchName: "feature/deploy",
          link: localState.link,
          environment: localState.environment,
          selectedTarget: {
            kind: "branch" as const,
            jobName: "feature/deploy",
            jobUrl: "job/main/job/feature%2Fdeploy/",
            jobColor: "blue"
          }
        }
      })
    };
    const dataService = {
      getJob: async () => {
        jobCalls += 1;
        return {
          name: "feature/deploy",
          url: "job/main/job/feature%2Fdeploy/",
          lastBuild: { number: jobCalls, result: "SUCCESS" }
        };
      }
    } as unknown as JenkinsDataService;
    const resolver = new CurrentBranchStatusResolver(
      dataService,
      targetResolver as unknown as InstanceType<typeof CurrentBranchTargetResolver>
    );

    const first = await resolver.resolve(localState, {});
    const second = await resolver.resolve(localState, {});
    const refreshed = await resolver.resolve(localState, { force: true });

    assert.equal(first.kind, "matched");
    assert.equal(second.kind, "matched");
    assert.equal(refreshed.kind, "matched");
    assert.equal(first.lastBuild?.number, 1);
    assert.equal(second.lastBuild?.number, 1);
    assert.equal(refreshed.lastBuild?.number, 2);
    assert.equal(jobCalls, 2);
  });
});

function createRepositoryResolver(
  repositories: GitRepository[]
): InstanceType<typeof CurrentBranchRepositoryResolver> {
  const resolver = new CurrentBranchRepositoryResolver();
  (resolver as unknown as { gitApi: GitApi }).gitApi = {
    repositories,
    onDidOpenRepository: noopEvent,
    onDidCloseRepository: noopEvent
  };
  return resolver;
}

function createGitRepository(
  rootFsPath: string,
  options: { selected?: boolean } = {}
): GitRepository {
  return {
    rootUri: TestUri.file(rootFsPath) as never,
    state: {
      HEAD: { name: "main", type: 0 },
      onDidChange: noopEvent as never
    },
    ui: {
      selected: options.selected,
      onDidChange: noopEvent as never
    }
  };
}

function createTargetFixture(options: {
  pullRequestResolution: CurrentBranchPullRequestResolution;
  jobs: CurrentBranchPullRequestJobRef[];
  matcher?: CurrentBranchPullRequestJobMatcher["findMatch"];
}): {
  resolver: InstanceType<typeof CurrentBranchTargetResolver>;
  localState: CurrentBranchLinkedContext;
  readonly pullRequestCalls: number;
  readonly jobCalls: number;
} {
  let pullRequestCalls = 0;
  let jobCalls = 0;
  const dataService = {
    getJobsForFolder: async () => {
      const jobs = options.jobs;
      jobCalls += 1;
      return jobs;
    }
  } as unknown as JenkinsDataService;
  const pullRequestService = {
    resolve: async () => {
      pullRequestCalls += 1;
      return options.pullRequestResolution;
    }
  };
  const pullRequestJobMatcher = {
    findMatch: options.matcher ?? (() => undefined)
  };

  return {
    resolver: new CurrentBranchTargetResolver(
      dataService,
      pullRequestService as never,
      pullRequestJobMatcher
    ),
    localState: createLinkedContext(),
    get pullRequestCalls() {
      return pullRequestCalls;
    },
    get jobCalls() {
      return jobCalls;
    }
  };
}

function createLinkedContext(): CurrentBranchLinkedContext {
  const repository = createRepositoryContext("/workspace/app");
  return {
    kind: "linked",
    repository,
    branchName: "feature/deploy",
    link: {
      repositoryUri: repository.repositoryUriString,
      environment: { scope: "workspace", environmentId: "env-1" },
      multibranchFolderUrl: "job/main/",
      multibranchLabel: "main"
    },
    environment: createEnvironment()
  };
}

function createRepositoryContext(rootFsPath: string): CurrentBranchRepositoryContext {
  const repository = createGitRepository(rootFsPath);
  return {
    repository,
    repositoryUri: repository.rootUri,
    repositoryUriString: repository.rootUri.toString(),
    repositoryLabel: "app",
    repositoryPath: rootFsPath
  };
}

function createEnvironment(): JenkinsEnvironmentRef {
  return {
    scope: "workspace",
    environmentId: "env-1",
    url: "https://jenkins.example/"
  };
}
