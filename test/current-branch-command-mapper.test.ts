import assert from "node:assert/strict";
import Module = require("node:module");
import { describe, it } from "node:test";
import type { CurrentBranchState } from "../src/currentBranch/CurrentBranchTypes";

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

const vscodeMock = {
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  ThemeIcon: class {
    constructor(
      readonly id: string,
      readonly color?: unknown
    ) {}
  }
};

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad(request, parent, isMain);
};

const { CurrentBranchCommandMapper } =
  require("../src/currentBranch/CurrentBranchCommandMapper") as typeof import(
    "../src/currentBranch/CurrentBranchCommandMapper"
  );

moduleWithLoad._load = originalLoad;

describe("CurrentBranchCommandMapper.getActionUnavailableMessage", () => {
  it("explains a missing branch job instead of silently doing nothing", () => {
    const mapper = new CurrentBranchCommandMapper();

    const message = mapper.getActionUnavailableMessage(createBranchMissingState(), "triggerBuild");

    assert.deepEqual(message, {
      severity: "info",
      message: 'No Jenkins job found for branch "feature/deploy" under main.'
    });
  });

  it("reports when a matched job has no builds to open", () => {
    const mapper = new CurrentBranchCommandMapper();
    const matched = createMatchedState();

    assert.deepEqual(mapper.getActionUnavailableMessage(matched, "openLatestBuild"), {
      severity: "info",
      message: 'No builds were found for "feature/deploy" yet.'
    });
    assert.equal(mapper.getActionUnavailableMessage(matched, "triggerBuild"), undefined);
    assert.equal(mapper.getActionUnavailableMessage(matched, "openLastFailedBuild"), undefined);
  });

  it("stays silent only for states whose resolution already carries a message", () => {
    const mapper = new CurrentBranchCommandMapper();
    const unlinked: CurrentBranchState = { kind: "unlinked" };

    assert.equal(mapper.getActionUnavailableMessage(unlinked, "triggerBuild"), undefined);
    assert.equal(
      mapper.getActionUnavailableMessage(createRequestFailedState(), "triggerBuild"),
      undefined
    );

    const resolution = mapper.mapStateToResolution(unlinked);
    assert.equal(resolution.kind, "resolved");
    assert.equal(resolution.message?.message, "The active repository is not linked to Jenkins.");
  });

  it("describes every remaining non-actionable state", () => {
    const mapper = new CurrentBranchCommandMapper();

    for (const kind of ["noGit", "noRepository", "ambiguousRepository"] as const) {
      const message = mapper.getActionUnavailableMessage({ kind }, "triggerBuild");
      assert.equal(message?.severity, "info");
      assert.ok(message?.message && message.message.length > 0, `expected a message for ${kind}`);
    }

    const detached = mapper.getActionUnavailableMessage(createDetachedHeadState(), "triggerBuild");
    assert.deepEqual(detached, {
      severity: "info",
      message: "Check out a branch to use current-branch Jenkins actions."
    });
  });
});

function createRepositoryInfo(): Extract<
  CurrentBranchState,
  { kind: "branchMissing" }
>["repository"] {
  return {
    repositoryUriString: "file:///workspace/app",
    repositoryLabel: "app",
    repositoryPath: "/workspace/app"
  };
}

function createLink(): Extract<CurrentBranchState, { kind: "branchMissing" }>["link"] {
  return {
    repositoryUri: "file:///workspace/app",
    environment: { scope: "workspace", environmentId: "env-1" },
    multibranchFolderUrl: "job/main/",
    multibranchLabel: "main"
  };
}

function createEnvironment(): Extract<
  CurrentBranchState,
  { kind: "branchMissing" }
>["environment"] {
  return {
    scope: "workspace",
    environmentId: "env-1",
    url: "https://jenkins.example/"
  };
}

function createBranchMissingState(): CurrentBranchState {
  return {
    kind: "branchMissing",
    repository: createRepositoryInfo(),
    branchName: "feature/deploy",
    link: createLink(),
    environment: createEnvironment()
  };
}

function createMatchedState(): CurrentBranchState {
  return {
    kind: "matched",
    repository: createRepositoryInfo(),
    branchName: "feature/deploy",
    link: createLink(),
    environment: createEnvironment(),
    resolvedTargetKind: "branch",
    jobName: "feature/deploy",
    jobUrl: "job/main/job/feature%2Fdeploy/"
  };
}

function createDetachedHeadState(): CurrentBranchState {
  return {
    kind: "detachedHead",
    repository: createRepositoryInfo(),
    link: createLink(),
    environment: createEnvironment()
  };
}

function createRequestFailedState(): CurrentBranchState {
  return {
    kind: "requestFailed",
    repository: createRepositoryInfo(),
    branchName: "feature/deploy",
    message: "Jenkins unavailable"
  };
}
