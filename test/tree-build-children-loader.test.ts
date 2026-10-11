import assert from "node:assert/strict";
import { it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";
import { ArtifactTreeItem, BuildTreeItem } from "../src/tree/items/TreeBuildItems";
import { TreeBuildChildrenLoader } from "../src/tree/loader/TreeBuildChildrenLoader";
import type { TreeChildrenCacheManager } from "../src/tree/loader/TreeChildrenCacheManager";

it("preserves leading and trailing spaces in artifact paths", async () => {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  const paths = [" report.txt", "report.txt ", " reports/report.txt ", "report.txt"];
  const loader = new TreeBuildChildrenLoader(
    {
      getBuildArtifacts: async () => paths.map((relativePath) => ({ relativePath }))
    } as unknown as JenkinsDataService,
    {} as PendingInputRefreshCoordinator,
    {
      getCachedArtifacts: () => undefined,
      setCachedArtifacts: () => undefined
    } as unknown as TreeChildrenCacheManager,
    (kind, env, extra) => `${env.scope}:${env.environmentId}:${kind}:${extra ?? ""}`,
    10,
    () => ({}),
    () => ({}),
    {
      createEmptyPlaceholder: () => {
        throw new Error("unexpected empty placeholder");
      },
      createErrorPlaceholder: (_label, error) => {
        throw error;
      }
    }
  );
  const build = new BuildTreeItem(environment, {
    number: 1,
    url: `${environment.url}job/demo/1/`
  });

  const items = await loader.loadArtifactsForBuild(build);

  assert.deepEqual(
    items.map((item) => {
      assert.ok(item instanceof ArtifactTreeItem);
      return item.relativePath;
    }),
    paths
  );
});
