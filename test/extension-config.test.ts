import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.doMock("vscode", () => ({ workspace: { getConfiguration: () => undefined } }));
const {
  getArtifactPreviewCacheMaxEntries,
  getCurrentBranchPullRequestJobNamePatterns,
  getMaxCacheEntries,
  getQueuePollIntervalSeconds,
  getStatusRefreshIntervalSeconds
} = await import("../src/extension/ExtensionConfig");

const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as {
  contributes: {
    configuration: {
      properties: Record<
        string,
        { default?: unknown; maximum?: number; minimum?: number; pattern?: string; type?: string }
      >;
    };
  };
};

function createConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      Object.hasOwn(values, key) ? (values[key] as T) : (defaultValue as T)
  } as vscode.WorkspaceConfiguration;
}

describe("ExtensionConfig polling intervals", () => {
  it("clamps status refresh intervals below the manifest minimum", () => {
    assert.equal(getStatusRefreshIntervalSeconds(createConfig({ pollIntervalSeconds: 1 })), 5);
  });

  it("clamps queue poll intervals below the manifest minimum", () => {
    assert.equal(getQueuePollIntervalSeconds(createConfig({ queuePollIntervalSeconds: 1 })), 2);
  });
});

describe("discrete count configuration", () => {
  const propertyNames = [
    "jenkinsWorkbench.buildDetails.testSourceMatching.maxResultsPerPattern",
    "jenkinsWorkbench.jobSearchConcurrency",
    "jenkinsWorkbench.jobSearchMaxRetries",
    "jenkinsWorkbench.artifactPreviewCacheMaxEntries",
    "jenkinsWorkbench.maxCacheEntries",
    "jenkinsWorkbench.activity.maxItemsPerGroup",
    "jenkinsWorkbench.activity.maxScanResults",
    "jenkinsWorkbench.activity.jobSearchBatchSize",
    "jenkinsWorkbench.activity.pendingInputCandidateLimit",
    "jenkinsWorkbench.activity.pendingInputLookupConcurrency",
    "jenkinsWorkbench.activity.pendingInputBuildLookupLimit"
  ];

  it.each(propertyNames)("publishes bounded integer schema for %s", (propertyName) => {
    const schema = packageJson.contributes.configuration.properties[propertyName];

    assert.equal(schema.type, "integer");
    assert.equal(typeof schema.minimum, "number");
    assert.equal(typeof schema.maximum, "number");
  });

  it("normalizes legacy fractional and excessive cache counts", () => {
    assert.equal(
      getArtifactPreviewCacheMaxEntries(createConfig({ artifactPreviewCacheMaxEntries: 3.8 })),
      3
    );
    assert.equal(
      getArtifactPreviewCacheMaxEntries(createConfig({ artifactPreviewCacheMaxEntries: 100_000 })),
      1000
    );
    assert.equal(getMaxCacheEntries(createConfig({ maxCacheEntries: 1000.9 })), 1000);
    assert.equal(getMaxCacheEntries(createConfig({ maxCacheEntries: 1_000_000 })), 100_000);
  });
});

describe("ExtensionConfig current branch pull request job patterns", () => {
  it("uses the contributed configuration default when the setting is absent", () => {
    const contributedDefault =
      packageJson.contributes.configuration.properties[
        "jenkinsWorkbench.currentBranch.pullRequestJobNamePatterns"
      ].default;

    assert.deepEqual(
      getCurrentBranchPullRequestJobNamePatterns(createConfig({})),
      contributedDefault
    );
  });
});

describe("artifact download root configuration schema", () => {
  const schema =
    packageJson.contributes.configuration.properties["jenkinsWorkbench.artifactDownloadRoot"];
  const pattern = new RegExp(schema.pattern ?? "");

  it.each([
    "",
    "   ",
    "/outside",
    "\\\\server\\share",
    "C:\\outside",
    "C:outside",
    "../outside",
    "safe/../outside"
  ])("rejects invalid root %j", (value) => {
    assert.equal(pattern.test(value), false);
  });

  it("accepts a nested workspace-relative root", () => {
    assert.equal(pattern.test("downloads/artifacts"), true);
  });
});
