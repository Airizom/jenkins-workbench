import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../src/jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import type { BuildDetailsCoverageBackend } from "../src/panels/buildDetails/BuildDetailsBackend";
import type { BuildDetailsCoverageDecorationsAdapter } from "../src/panels/buildDetails/BuildDetailsCoverageDecorationsAdapter";
import type { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";

const configValues: Record<string, unknown> = {};

vi.doMock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: <T>(key: string, defaultValue?: T): T =>
        Object.prototype.hasOwnProperty.call(configValues, key)
          ? (configValues[key] as T)
          : (defaultValue as T)
    })
  }
}));

const { BuildDetailsCoverageCoordinator, planCoverageRefresh } = await import(
  "../src/panels/buildDetails/BuildDetailsCoverageCoordinator"
);

function setCoverageConfig(options: { coverage?: boolean; decorations?: boolean } = {}): void {
  configValues["buildDetails.coverage.enabled"] = options.coverage ?? true;
  configValues["buildDetails.coverageDecorations.enabled"] = options.decorations ?? true;
}

function createEnvironment(): JenkinsEnvironmentRef {
  return { environmentId: "env-1", scope: "global", url: "https://jenkins.example/" };
}

function createDetails(overrides: Partial<JenkinsBuildDetails> = {}): JenkinsBuildDetails {
  return {
    number: 12,
    url: "https://jenkins.example/job/app/12/",
    building: false,
    ...overrides
  };
}

function createDetailsWithCoverageAction(): JenkinsBuildDetails {
  return createDetails({
    actions: [
      {
        _class: "io.jenkins.plugins.coverage.metrics.steps.CoverageBuildAction",
        urlName: "coverage"
      }
    ]
  });
}

function createOverview(): JenkinsCoverageOverview {
  return { projectCoverage: "81%", qualityGates: [] };
}

function createModifiedFiles(): JenkinsModifiedCoverageFile[] {
  return [{ path: "src/app.ts", blocks: [{ startLine: 1, endLine: 3, type: "covered" }] }];
}

interface HarnessOptions {
  environment?: JenkinsEnvironmentRef | undefined;
  buildUrl?: string | undefined;
  details?: JenkinsBuildDetails | undefined;
  backend?: Partial<BuildDetailsCoverageBackend>;
  hasBackend?: boolean;
  isTokenCurrent?: (token: number) => boolean;
  isViewVisible?: () => boolean;
  coverageLoadingChanged?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const calls: string[] = [];
  const setCoverageArgs: Array<[unknown, unknown]> = [];
  const applyOptions: Array<Record<string, unknown>> = [];

  const backend: BuildDetailsCoverageBackend = {
    discoverCoverageActionPath: async () => {
      calls.push("backend.discover");
      return "coverage";
    },
    getCoverageOverview: async () => {
      calls.push("backend.overview");
      return createOverview();
    },
    getModifiedCoverageFiles: async () => {
      calls.push("backend.modifiedFiles");
      return createModifiedFiles();
    },
    ...options.backend
  };

  const state = {
    environment: "environment" in options ? options.environment : createEnvironment(),
    currentBuildUrl:
      "buildUrl" in options ? options.buildUrl : "https://jenkins.example/job/app/12/",
    currentDetails: "details" in options ? options.details : createDetails(),
    setCoverageActionPath: (actionPath: string | undefined): boolean => {
      calls.push(`state.setCoverageActionPath:${actionPath}`);
      return true;
    },
    setCoverageLoading: (value: boolean): boolean => {
      calls.push(`state.setCoverageLoading:${value}`);
      return value ? (options.coverageLoadingChanged ?? true) : true;
    },
    setCoverage: (overview: unknown, files: unknown): void => {
      calls.push("state.setCoverage");
      setCoverageArgs.push([overview, files]);
    },
    setCoverageError: (error: string): void => {
      calls.push(`state.setCoverageError:${error}`);
    },
    resetCoverage: (): void => {
      calls.push("state.resetCoverage");
    }
  };

  const decorationsAdapter = {
    dispose: (): void => {
      calls.push("adapter.dispose");
    },
    activate: (): void => {
      calls.push("adapter.activate");
    },
    deactivate: (): void => {
      calls.push("adapter.deactivate");
    },
    clear: (): void => {
      calls.push("adapter.clear");
    },
    apply: (applyOpts: Record<string, unknown>): void => {
      calls.push("adapter.apply");
      applyOptions.push(applyOpts);
    }
  };

  const coordinator = new BuildDetailsCoverageCoordinator({
    state: state as unknown as BuildDetailsPanelState,
    decorationsAdapter: decorationsAdapter as unknown as BuildDetailsCoverageDecorationsAdapter,
    getCoverageBackend: () => ((options.hasBackend ?? true) ? backend : undefined),
    isTokenCurrent: options.isTokenCurrent ?? (() => true),
    isViewVisible: options.isViewVisible ?? (() => true),
    postStateUpdate: () => {
      calls.push("postStateUpdate");
    }
  });

  return { coordinator, calls, setCoverageArgs, applyOptions };
}

function createPlanContext(
  overrides: Partial<Parameters<typeof planCoverageRefresh>[0]> = {}
): Parameters<typeof planCoverageRefresh>[0] {
  return {
    coverageBackend: {} as BuildDetailsCoverageBackend,
    environment: createEnvironment(),
    buildUrl: "https://jenkins.example/job/app/12/",
    details: createDetails(),
    coverageEnabled: true,
    decorationsEnabled: true,
    showLoadingRequested: false,
    ...overrides
  };
}

describe("planCoverageRefresh", () => {
  it("skips when the coverage backend is missing", () => {
    const plan = planCoverageRefresh(createPlanContext({ coverageBackend: undefined }));
    assert.deepEqual(plan, { kind: "skip" });
  });

  it("skips when the environment is missing", () => {
    const plan = planCoverageRefresh(createPlanContext({ environment: undefined }));
    assert.deepEqual(plan, { kind: "skip" });
  });

  it("skips when the build URL is missing", () => {
    const plan = planCoverageRefresh(createPlanContext({ buildUrl: undefined }));
    assert.deepEqual(plan, { kind: "skip" });
  });

  it("clears when the build is still running", () => {
    const plan = planCoverageRefresh(
      createPlanContext({ details: createDetails({ building: true }) })
    );
    assert.deepEqual(plan, { kind: "clear" });
  });

  it("clears when coverage and decorations are both disabled", () => {
    const plan = planCoverageRefresh(
      createPlanContext({ coverageEnabled: false, decorationsEnabled: false })
    );
    assert.deepEqual(plan, { kind: "clear" });
  });

  it("loads when only decorations are enabled and never shows loading with coverage disabled", () => {
    const plan = planCoverageRefresh(
      createPlanContext({
        coverageEnabled: false,
        decorationsEnabled: true,
        showLoadingRequested: true
      })
    );
    assert.equal(plan.kind, "load");
    assert.ok(plan.kind === "load");
    assert.equal(plan.request.showLoading, false);
    assert.equal(plan.request.coverageEnabled, false);
    assert.equal(plan.request.decorationsEnabled, true);
  });

  it("treats missing details as a completed build and shows loading when requested", () => {
    const plan = planCoverageRefresh(
      createPlanContext({ details: undefined, showLoadingRequested: true })
    );
    assert.ok(plan.kind === "load");
    assert.equal(plan.request.buildCompleted, true);
    assert.equal(plan.request.showLoading, true);
  });

  it("does not show loading when it was not requested", () => {
    const plan = planCoverageRefresh(createPlanContext({ showLoadingRequested: false }));
    assert.ok(plan.kind === "load");
    assert.equal(plan.request.showLoading, false);
  });
});

describe("BuildDetailsCoverageCoordinator refresh", () => {
  it("does nothing when the coverage backend is missing", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({ hasBackend: false });

    await coordinator.refresh(1);

    assert.deepEqual(calls, []);
  });

  it("clears coverage and posts an update when the build is running and the view is visible", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      details: createDetails({ building: true })
    });

    await coordinator.refresh(1);

    assert.deepEqual(calls, ["adapter.clear", "state.resetCoverage", "postStateUpdate"]);
  });

  it("clears coverage without posting when the view is hidden", async () => {
    setCoverageConfig({ coverage: false, decorations: false });
    const { coordinator, calls } = createHarness({ isViewVisible: () => false });

    await coordinator.refresh(1);

    assert.deepEqual(calls, ["adapter.clear", "state.resetCoverage"]);
  });

  it("resolves the action path from build actions and applies coverage when visible", async () => {
    setCoverageConfig();
    const { coordinator, calls, setCoverageArgs, applyOptions } = createHarness({
      details: createDetailsWithCoverageAction()
    });

    await coordinator.refresh(1);

    assert.deepEqual(calls, [
      "state.setCoverageActionPath:coverage",
      "backend.overview",
      "backend.modifiedFiles",
      "state.setCoverage",
      "state.setCoverageLoading:false",
      "adapter.apply",
      "adapter.activate",
      "postStateUpdate"
    ]);
    assert.deepEqual(setCoverageArgs, [[createOverview(), createModifiedFiles()]]);
    assert.deepEqual(applyOptions, [
      {
        environment: createEnvironment(),
        buildUrl: "https://jenkins.example/job/app/12/",
        modifiedCoverageFiles: createModifiedFiles(),
        coverageOverview: createOverview(),
        decorationsEnabled: true
      }
    ]);
  });

  it("does not activate decorations or post an update when the view is hidden on success", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      isViewVisible: () => false
    });

    await coordinator.refresh(1);

    assert.ok(calls.includes("adapter.apply"));
    assert.ok(!calls.includes("adapter.activate"));
    assert.ok(!calls.includes("postStateUpdate"));
  });

  it("discovers the action path via the backend when details lack coverage actions", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness();

    await coordinator.refresh(1);

    assert.equal(calls[0], "backend.discover");
    assert.ok(calls.includes("state.setCoverageActionPath:coverage"));
    assert.ok(calls.includes("state.setCoverage"));
  });

  it("clears resolved coverage when no action path can be discovered", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      backend: { discoverCoverageActionPath: async () => undefined }
    });

    await coordinator.refresh(1);

    assert.deepEqual(calls, ["adapter.clear", "state.resetCoverage", "postStateUpdate"]);
  });

  it("returns early when the token becomes stale while resolving the action path", async () => {
    setCoverageConfig();
    let tokenCurrent = true;
    const { coordinator, calls } = createHarness({
      isTokenCurrent: () => tokenCurrent,
      backend: {
        discoverCoverageActionPath: async () => {
          tokenCurrent = false;
          return "coverage";
        }
      }
    });

    await coordinator.refresh(1);

    assert.ok(!calls.includes("state.setCoverageActionPath:coverage"));
    assert.ok(!calls.includes("state.setCoverage"));
  });

  it("abandons a refresh that is superseded before the action path resolves", async () => {
    setCoverageConfig();
    let resolveDiscover: ((value: string | undefined) => void) | undefined;
    const { coordinator, calls } = createHarness({
      backend: {
        discoverCoverageActionPath: () =>
          new Promise<string | undefined>((resolve) => {
            resolveDiscover = resolve;
          })
      }
    });

    const pending = coordinator.refresh(1);
    coordinator.dispose();
    resolveDiscover?.("coverage");
    await pending;

    assert.deepEqual(calls, ["adapter.dispose"]);
  });

  it("posts a loading update before results when requested and the loading state changed", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction()
    });

    await coordinator.refresh(1, { showLoading: true });

    assert.deepEqual(calls.slice(0, 3), [
      "state.setCoverageActionPath:coverage",
      "state.setCoverageLoading:true",
      "postStateUpdate"
    ]);
    assert.ok(calls.includes("state.setCoverage"));
  });

  it("does not post a loading update when the loading state did not change", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      coverageLoadingChanged: false
    });

    await coordinator.refresh(1, { showLoading: true });

    assert.equal(calls[1], "state.setCoverageLoading:true");
    assert.notEqual(calls[2], "postStateUpdate");
    assert.equal(calls.filter((call) => call === "postStateUpdate").length, 1);
  });

  it("returns early when the token becomes stale while loading coverage data", async () => {
    setCoverageConfig();
    let tokenCurrent = true;
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      isTokenCurrent: () => tokenCurrent,
      backend: {
        getModifiedCoverageFiles: async () => {
          tokenCurrent = false;
          return createModifiedFiles();
        }
      }
    });

    await coordinator.refresh(1);

    assert.ok(!calls.includes("state.setCoverage"));
    assert.ok(!calls.includes("adapter.apply"));
  });

  it("skips the overview fetch and stores no coverage when only decorations are enabled", async () => {
    setCoverageConfig({ coverage: false, decorations: true });
    const { coordinator, calls, setCoverageArgs, applyOptions } = createHarness({
      details: createDetailsWithCoverageAction()
    });

    await coordinator.refresh(1);

    assert.ok(!calls.includes("backend.overview"));
    assert.ok(calls.includes("backend.modifiedFiles"));
    assert.deepEqual(setCoverageArgs, [[undefined, undefined]]);
    assert.equal(applyOptions.length, 1);
    assert.deepEqual(applyOptions[0].modifiedCoverageFiles, createModifiedFiles());
    assert.equal(applyOptions[0].coverageOverview, undefined);
  });

  it("swallows modified-file errors when the overview loaded successfully", async () => {
    setCoverageConfig();
    const { coordinator, calls, setCoverageArgs } = createHarness({
      details: createDetailsWithCoverageAction(),
      backend: {
        getModifiedCoverageFiles: async () => {
          throw new Error("modified files failed");
        }
      }
    });

    await coordinator.refresh(1);

    assert.ok(!calls.some((call) => call.startsWith("state.setCoverageError")));
    assert.deepEqual(setCoverageArgs, [[createOverview(), undefined]]);
  });

  it("reports an error when the coverage load fails without an overview", async () => {
    setCoverageConfig({ coverage: false, decorations: true });
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      backend: {
        getModifiedCoverageFiles: async () => {
          throw new Error("modified files failed");
        }
      }
    });

    await coordinator.refresh(1);

    assert.deepEqual(calls.slice(1), [
      "adapter.clear",
      "state.setCoverageError:modified files failed",
      "state.setCoverageLoading:false",
      "postStateUpdate"
    ]);
  });

  it("reports overview errors without posting when the view is hidden", async () => {
    setCoverageConfig();
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      isViewVisible: () => false,
      backend: {
        getCoverageOverview: async () => {
          throw new Error("overview failed");
        }
      }
    });

    await coordinator.refresh(1);

    assert.ok(calls.includes("state.setCoverageError:overview failed"));
    assert.ok(!calls.includes("postStateUpdate"));
  });

  it("suppresses error handling when the token became stale before the failure", async () => {
    setCoverageConfig();
    let tokenCurrent = true;
    const { coordinator, calls } = createHarness({
      details: createDetailsWithCoverageAction(),
      isTokenCurrent: () => tokenCurrent,
      backend: {
        getCoverageOverview: async () => {
          tokenCurrent = false;
          throw new Error("overview failed");
        }
      }
    });

    await coordinator.refresh(1);

    assert.ok(!calls.some((call) => call.startsWith("state.setCoverageError")));
    assert.ok(!calls.includes("adapter.clear"));
  });
});

describe("BuildDetailsCoverageCoordinator lifecycle", () => {
  it("disposes the decorations adapter", () => {
    const { coordinator, calls } = createHarness();
    coordinator.dispose();
    assert.deepEqual(calls, ["adapter.dispose"]);
  });

  it("activates decorations when the panel becomes visible and deactivates when hidden", () => {
    const { coordinator, calls } = createHarness();
    coordinator.handlePanelVisible();
    coordinator.handlePanelHidden();
    assert.deepEqual(calls, ["adapter.activate", "adapter.deactivate"]);
  });
});
