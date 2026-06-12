import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { CurrentBranchGitHubPullRequestLookupResult } from "../src/currentBranch/CurrentBranchGitHubPullRequestAdapter";
import type {
  CurrentBranchPullRequestJobMatcher,
  CurrentBranchPullRequestJobRef
} from "../src/currentBranch/CurrentBranchPullRequestJobMatcher";
import type {
  CurrentBranchLinkedContext,
  CurrentBranchRepositoryContext,
  CurrentBranchState
} from "../src/currentBranch/CurrentBranchTypes";
import type { GitApi, GitRepository } from "../src/git/GitExtensionApi";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { exactModuleMock, withModuleMocks } from "./helpers/moduleMock";
import { createCurrentBranchVscodeMock, TestUri } from "./helpers/vscodeMocks";

let githubPullRequestExtension:
  | { isActive: boolean; exports: unknown; activate: () => Promise<unknown> }
  | undefined;

const vscodeMock = createCurrentBranchVscodeMock({
  githubPullRequestExtension: () => githubPullRequestExtension
});

const {
  CurrentBranchRepositoryResolver,
  CurrentBranchTargetResolver,
  CurrentBranchStatusResolver,
  CurrentBranchRefreshCoordinator,
  CurrentBranchJenkinsService,
  CurrentBranchPullRequestService,
  VscodeCurrentBranchGitHubPullRequestAdapter
} = withModuleMocks([exactModuleMock("vscode", vscodeMock)], () => ({
  ...(require("../src/currentBranch/CurrentBranchRepositoryResolver") as typeof import(
    "../src/currentBranch/CurrentBranchRepositoryResolver"
  )),
  ...(require("../src/currentBranch/CurrentBranchTargetResolver") as typeof import(
    "../src/currentBranch/CurrentBranchTargetResolver"
  )),
  ...(require("../src/currentBranch/CurrentBranchStatusResolver") as typeof import(
    "../src/currentBranch/CurrentBranchStatusResolver"
  )),
  ...(require("../src/currentBranch/CurrentBranchRefreshCoordinator") as typeof import(
    "../src/currentBranch/CurrentBranchRefreshCoordinator"
  )),
  ...(require("../src/currentBranch/CurrentBranchJenkinsService") as typeof import(
    "../src/currentBranch/CurrentBranchJenkinsService"
  )),
  ...(require("../src/currentBranch/CurrentBranchPullRequestService") as typeof import(
    "../src/currentBranch/CurrentBranchPullRequestService"
  )),
  ...(require("../src/currentBranch/CurrentBranchGitHubPullRequestAdapter") as typeof import(
    "../src/currentBranch/CurrentBranchGitHubPullRequestAdapter"
  ))
}));

const noopEvent = (() => ({
  dispose: () => undefined
})) as unknown as GitApi["onDidOpenRepository"];

beforeEach(() => {
  vscodeMock.window.activeTextEditor = undefined;
  githubPullRequestExtension = undefined;
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
      pullRequestLookup: {
        kind: "available",
        snapshot: {
          pullRequest: {
            number: 42,
            title: "Add deployment",
            url: "https://github.example/pull/42",
            headBranch: "feature/deploy"
          }
        }
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

  it("falls back to the pull request head branch job when no pull request job matches", async () => {
    const fixture = createTargetFixture({
      pullRequestLookup: {
        kind: "available",
        snapshot: {
          pullRequest: {
            number: 42,
            url: "https://github.example/pull/42",
            headBranch: "feature/deployment-v2"
          }
        }
      },
      jobs: [{ name: "feature%2Fdeployment-v2", url: "job/main/job/feature%2Fdeployment-v2/" }]
    });

    const resolution = await fixture.resolver.resolve(fixture.localState, {});

    assert.equal(resolution.kind, "selected");
    assert.equal(resolution.target.branchName, "feature/deployment-v2");
    assert.equal(resolution.target.selectedTarget.kind, "branch");
    assert.equal(resolution.target.selectedTarget.jobUrl, "job/main/job/feature%2Fdeployment-v2/");
  });

  it("matches URL-encoded Jenkins branch names and reports missing branches", async () => {
    const matched = createTargetFixture({
      pullRequestLookup: { kind: "available", snapshot: {} },
      jobs: [{ name: "feature%2Fdeploy", url: "job/main/job/feature%2Fdeploy/" }]
    });

    const selected = await matched.resolver.resolve(matched.localState, {});

    assert.equal(selected.kind, "selected");
    assert.equal(selected.target.selectedTarget.kind, "branch");
    assert.equal(selected.target.selectedTarget.jobName, "feature/deploy");

    const missing = createTargetFixture({
      pullRequestLookup: { kind: "available", snapshot: {} },
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
      pullRequestLookup: { kind: "available", snapshot: {} },
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

describe("VscodeCurrentBranchGitHubPullRequestAdapter", () => {
  it("snapshots the pull request head branch from the extension metadata", async () => {
    const { result } = await lookupAvailablePullRequest({
      number: 42,
      title: " Add deployment ",
      url: "https://github.example/pull/42",
      headRefName: "feature/deploy"
    });

    assert.deepEqual(result.snapshot.pullRequest, {
      number: 42,
      title: "Add deployment",
      url: "https://github.example/pull/42",
      headBranch: "feature/deploy"
    });
  });

  it("accepts REST-shaped head refs and omits the head branch when absent", async () => {
    const { adapter, result } = await lookupAvailablePullRequest({
      number: 7,
      head: { ref: "bugfix/timeout" }
    });

    assert.equal(result.snapshot.pullRequest?.headBranch, "bugfix/timeout");
    assert.ok(githubPullRequestExtension);

    githubPullRequestExtension.exports = {
      getRepositoryDescription: async () => ({
        pullRequest: { number: 7 }
      })
    };

    const withoutHead = await adapter.lookup(createRepositoryContext("/workspace/app"));

    assert.equal(withoutHead.kind, "available");
    assert.equal(withoutHead.snapshot.pullRequest?.headBranch, undefined);
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

describe("CurrentBranchJenkinsService", () => {
  it("coalesces overlapping refreshes into one forced follow-up", async () => {
    const fixture = createCurrentBranchServiceFixture();
    try {
      const firstRefresh = fixture.service.refresh();
      await fixture.waitForResolveCallCount(1);

      const forcedRefresh = fixture.service.refresh({ force: true });
      const duplicateRefresh = fixture.service.refresh();
      await flushPromises();

      assert.equal(fixture.resolveCalls.length, 1);
      fixture.resolveCalls[0].deferred.resolve(createMatchedState(fixture.localState, 1));

      const firstState = await firstRefresh;
      await fixture.waitForResolveCallCount(2);

      assert.equal(firstState.kind, "noGit");
      assert.equal(fixture.resolveCalls.length, 2);
      assert.deepEqual(fixture.resolveCalls[1].options, { force: true });

      fixture.resolveCalls[1].deferred.resolve(createMatchedState(fixture.localState, 2));
      const [forcedState, duplicateState] = await Promise.all([forcedRefresh, duplicateRefresh]);

      assert.equal(forcedState.kind, "matched");
      assert.equal(duplicateState.kind, "matched");
      assert.equal(forcedState.lastBuild?.number, 2);
      assert.equal(duplicateState.lastBuild?.number, 2);
      assert.equal(fixture.service.getState(), forcedState);
    } finally {
      fixture.service.dispose();
    }
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
  pullRequestLookup: CurrentBranchGitHubPullRequestLookupResult;
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
  // Use the production pull request service so adapter snapshots flow through
  // the same resolution path the extension uses at runtime.
  const pullRequestService = new CurrentBranchPullRequestService({
    lookup: async () => {
      pullRequestCalls += 1;
      return options.pullRequestLookup;
    }
  });
  const pullRequestJobMatcher = {
    findMatch: options.matcher ?? (() => undefined)
  };

  return {
    resolver: new CurrentBranchTargetResolver(
      dataService,
      pullRequestService,
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

async function lookupAvailablePullRequest(pullRequest: unknown): Promise<{
  adapter: InstanceType<typeof VscodeCurrentBranchGitHubPullRequestAdapter>;
  result: Extract<CurrentBranchGitHubPullRequestLookupResult, { kind: "available" }>;
}> {
  githubPullRequestExtension = {
    isActive: true,
    exports: {
      getRepositoryDescription: async () => ({ pullRequest })
    },
    activate: async () => undefined
  };
  const adapter = new VscodeCurrentBranchGitHubPullRequestAdapter();
  const result = await adapter.lookup(createRepositoryContext("/workspace/app"));
  assert.equal(result.kind, "available");
  return {
    adapter,
    result: result as Extract<CurrentBranchGitHubPullRequestLookupResult, { kind: "available" }>
  };
}

function createEnvironment(): JenkinsEnvironmentRef {
  return {
    scope: "workspace",
    environmentId: "env-1",
    url: "https://jenkins.example/"
  };
}

function createCurrentBranchServiceFixture(): {
  service: InstanceType<typeof CurrentBranchJenkinsService>;
  localState: CurrentBranchLinkedContext;
  resolveCalls: Array<{
    options: { force?: boolean };
    deferred: Deferred<CurrentBranchState>;
  }>;
  waitForResolveCallCount: (count: number) => Promise<void>;
} {
  const localState = createLinkedContext();
  const resolveCalls: Array<{
    options: { force?: boolean };
    deferred: Deferred<CurrentBranchState>;
  }> = [];
  let notifyResolveCall: () => void = () => undefined;
  const repositoryResolver = {
    dispose: () => undefined,
    initialize: async () => undefined,
    onDidChange: noopEvent,
    listRepositories: () => [localState.repository],
    resolveActiveRepository: () => localState.repository
  };
  const linkResolver = {
    onDidChange: noopEvent,
    resolve: async () => localState
  };
  const statusResolver = {
    dispose: () => undefined,
    resolve: async (_state: CurrentBranchLinkedContext, options: { force?: boolean }) => {
      const deferred = createDeferred<CurrentBranchState>();
      resolveCalls.push({ options, deferred });
      notifyResolveCall();
      return deferred.promise;
    }
  };
  const eventSource = {
    onDidChange: noopEvent,
    onDidTick: noopEvent
  };
  const service = new CurrentBranchJenkinsService(
    repositoryResolver as never,
    eventSource as never,
    linkResolver as never,
    statusResolver as never,
    new CurrentBranchRefreshCoordinator(),
    eventSource as never
  );

  return {
    service,
    localState,
    resolveCalls,
    waitForResolveCallCount: async (count: number) => {
      // Fail fast instead of hanging the suite when a resolve call never arrives.
      const timeoutMs = 2000;
      const deadline = Date.now() + timeoutMs;
      while (resolveCalls.length < count) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(
            `Timed out after ${timeoutMs}ms waiting for resolve call ${count}; saw ${resolveCalls.length}.`
          );
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(
              new Error(
                `Timed out after ${timeoutMs}ms waiting for resolve call ${count}; saw ${resolveCalls.length}.`
              )
            );
          }, remainingMs);
          notifyResolveCall = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
  };
}

function createMatchedState(
  localState: CurrentBranchLinkedContext,
  buildNumber: number
): CurrentBranchState {
  return {
    kind: "matched",
    repository: {
      repositoryUriString: localState.repository.repositoryUriString,
      repositoryLabel: localState.repository.repositoryLabel,
      repositoryPath: localState.repository.repositoryPath
    },
    branchName: localState.branchName,
    link: localState.link,
    environment: localState.environment,
    resolvedTargetKind: "branch",
    jobName: localState.branchName,
    jobUrl: "job/main/job/feature%2Fdeploy/",
    lastBuild: { number: buildNumber }
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
