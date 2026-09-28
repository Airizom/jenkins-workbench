import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { loadBuildCompareViewModel } from "../src/panels/buildCompare/BuildCompareViewModel";
import type { BuildInspectionBackend } from "../src/panels/shared/backend/BuildInspectionBackend";

const ENVIRONMENT: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "global",
  url: "https://jenkins.example/"
};

const BASELINE_URL = "https://jenkins.example/job/example/1/";
const TARGET_URL = "https://jenkins.example/job/example/2/";

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("loadBuildCompareViewModel", () => {
  it("starts optional requests before build details finish loading", async () => {
    const baselineDetails = createDeferred<JenkinsBuildDetails>();
    const targetDetails = createDeferred<JenkinsBuildDetails>();
    const calls: string[] = [];
    const backend = {
      status: {
        getBuildDetails: (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
          calls.push(`details:${buildUrl}`);
          return buildUrl === BASELINE_URL ? baselineDetails.promise : targetDetails.promise;
        },
        getWorkflowRun: async (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
          calls.push(`workflow:${buildUrl}`);
          return undefined;
        }
      },
      tests: {
        getTestReport: async (_environment: JenkinsEnvironmentRef, buildUrl: string) => {
          calls.push(`tests:${buildUrl}`);
          return undefined;
        }
      }
    } as unknown as BuildInspectionBackend;

    const viewModelPromise = loadBuildCompareViewModel(backend, {
      environment: ENVIRONMENT,
      baselineBuildUrl: BASELINE_URL,
      targetBuildUrl: TARGET_URL,
      compareOptions: {
        console: { maxBytes: 1024, maxLines: 100 },
        parameterRedaction: {
          allowList: [],
          denyList: [],
          maskPatterns: [],
          maskValue: "[redacted]"
        }
      }
    });

    assert.deepEqual(calls, [
      `details:${BASELINE_URL}`,
      `details:${TARGET_URL}`,
      `tests:${BASELINE_URL}`,
      `tests:${TARGET_URL}`,
      `workflow:${BASELINE_URL}`,
      `workflow:${TARGET_URL}`
    ]);

    baselineDetails.resolve({ number: 1, url: BASELINE_URL });
    targetDetails.resolve({ number: 2, url: TARGET_URL });
    const viewModel = await viewModelPromise;

    assert.equal(viewModel.baseline.buildUrl, BASELINE_URL);
    assert.equal(viewModel.target.buildUrl, TARGET_URL);
    // Without a full display name the job name falls back to the /job/ URL segments.
    assert.equal(viewModel.target.buildNumberLabel, "#2");
    assert.equal(viewModel.target.jobDisplayName, "example");
  });
});

describe("buildBuildViewModel", () => {
  it("strips the build display name from the full display name to get the job", async () => {
    const { buildBuildViewModel } = await import(
      "../src/panels/buildCompare/BuildCompareSectionShared"
    );

    const standard = buildBuildViewModel("Target", {
      number: 1482,
      url: "https://jenkins.example/job/web-app/job/main/1482/",
      displayName: "#1482",
      fullDisplayName: "web-app » main #1482"
    });
    assert.equal(standard.jobDisplayName, "web-app » main");
    assert.equal(standard.buildNumberLabel, "#1482");

    const custom = buildBuildViewModel("Target", {
      number: 7,
      url: "https://jenkins.example/job/web-app/job/feature%2Flogin/7/",
      displayName: "release candidate",
      fullDisplayName: "web-app » feature/login release candidate"
    });
    assert.equal(custom.jobDisplayName, "web-app » feature/login");
    assert.equal(custom.buildNumberLabel, "#7");

    const fromUrl = buildBuildViewModel("Target", {
      number: 3,
      url: "https://jenkins.example/job/web-app/job/feature%2Flogin/3/"
    });
    assert.equal(fromUrl.jobDisplayName, "web-app » feature/login");
  });
});
