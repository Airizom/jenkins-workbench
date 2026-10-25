import assert from "node:assert/strict";
import { it } from "vitest";
import type { BuildListFetchOptions, JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";
import { ArtifactTreeItem, BuildTreeItem } from "../src/tree/items/TreeBuildItems";
import type { JobTreeItem } from "../src/tree/items/TreeJobItems";
import { TreeBuildChildrenLoader } from "../src/tree/loader/TreeBuildChildrenLoader";
import { ROOT_TREE_JOB_SCOPE } from "../src/tree/TreeJobScope";
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

it("requests build descriptions for tree build lists on top of the configured options", async () => {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  const calls: Array<{ jobUrl: string; limit: number; options?: BuildListFetchOptions }> = [];
  const loader = new TreeBuildChildrenLoader(
    {
      getBuildsForJob: async (
        _env: JenkinsEnvironmentRef,
        jobUrl: string,
        limit: number,
        options?: BuildListFetchOptions
      ) => {
        calls.push({ jobUrl, limit, options });
        return [{ number: 1, url: `${jobUrl}1/`, description: "<b>release</b>" }];
      }
    } as unknown as JenkinsDataService,
    {} as PendingInputRefreshCoordinator,
    {
      getOrLoadChildren: (
        _key: string,
        _element: unknown,
        load: (isCurrentLoad: () => boolean) => Promise<unknown[]>
      ) => load(() => true)
    } as unknown as TreeChildrenCacheManager,
    (kind, env, extra) => `${env.scope}:${env.environmentId}:${kind}:${extra ?? ""}`,
    10,
    () => ({}),
    () => ({ detailLevel: "details", includeParameters: true }),
    {
      createEmptyPlaceholder: () => {
        throw new Error("unexpected empty placeholder");
      },
      createErrorPlaceholder: (_label, error) => {
        throw error;
      }
    }
  );
  const jobUrl = `${environment.url}job/demo/`;
  const job = {
    environment,
    jobUrl,
    jobScope: ROOT_TREE_JOB_SCOPE,
    label: "demo"
  } as unknown as JobTreeItem;

  const items = await loader.loadBuildChildren(job);

  assert.equal(items.length, 1);
  assert.ok(items[0] instanceof BuildTreeItem);
  assert.deepEqual(calls, [
    {
      jobUrl,
      limit: 10,
      options: { detailLevel: "details", includeParameters: true, includeDescription: true }
    }
  ]);
});
