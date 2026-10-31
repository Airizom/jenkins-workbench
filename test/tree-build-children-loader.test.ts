import assert from "node:assert/strict";
import { it } from "vitest";
import type { BuildListFetchOptions, JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";
import { ArtifactTreeItem, BuildTreeItem } from "../src/tree/items/TreeBuildItems";
import type { JobTreeItem } from "../src/tree/items/TreeJobItems";
import {
  MAX_TREE_BUILDS,
  REQUESTED_BUILD_COUNTS_MAX_ENTRIES,
  TreeBuildChildrenLoader
} from "../src/tree/loader/TreeBuildChildrenLoader";
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

const PAGE_SIZE = 20;

/** Loads through a shared children cache, as rendered copies of one job do. */
function createPagingFixture(totalBuilds: number) {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  const requests: Array<{ jobUrl: string; limit: number; offset?: number }> = [];
  const clearedKeys: string[] = [];
  const cached = new Map<string, unknown[]>();
  const placeholders: Array<{ label: string; description?: string; command?: unknown }> = [];
  const loader = new TreeBuildChildrenLoader(
    {
      getBuildsForJob: async (
        _env: JenkinsEnvironmentRef,
        jobUrl: string,
        limit: number,
        options?: BuildListFetchOptions
      ) => {
        requests.push({ jobUrl, limit, offset: options?.offset });
        return Array.from({ length: Math.min(limit, totalBuilds) }, (_, index) => ({
          number: totalBuilds - index,
          url: `${jobUrl}${totalBuilds - index}/`
        }));
      }
    } as unknown as JenkinsDataService,
    {} as PendingInputRefreshCoordinator,
    {
      getOrLoadChildren: async (
        key: string,
        _element: unknown,
        load: (isCurrentLoad: () => boolean) => Promise<unknown[]>
      ) => {
        const items = cached.get(key) ?? (await load(() => true));
        cached.set(key, items);
        return items;
      },
      clearChildrenCache: (key: string) => {
        clearedKeys.push(key);
        cached.delete(key);
      }
    } as unknown as TreeChildrenCacheManager,
    (kind, env, extra) => `${env.scope}:${env.environmentId}:${kind}:${extra ?? ""}`,
    PAGE_SIZE,
    () => ({}),
    () => ({}),
    {
      createEmptyPlaceholder: (label, description, options) => {
        const placeholder = { label, description, command: options?.command };
        placeholders.push(placeholder);
        return placeholder as never;
      },
      createErrorPlaceholder: (_label, error) => {
        throw error;
      }
    }
  );
  const job = (name: string) =>
    ({
      environment,
      jobUrl: `${environment.url}job/${name}/`,
      jobScope: ROOT_TREE_JOB_SCOPE,
      label: name
    }) as unknown as JobTreeItem;
  return { loader, requests, clearedKeys, placeholders, job };
}

it("pages a job's builds from allBuilds and clears only that job's cached children", async () => {
  const fixture = createPagingFixture(1000);
  const job = fixture.job("demo");

  await fixture.loader.loadBuildChildren(job);
  assert.equal(fixture.loader.loadMoreBuilds(job), true);
  assert.deepEqual(fixture.clearedKeys, [
    fixture.loader.buildBuildsChildrenKey(job.environment, job.jobUrl, job.jobScope)
  ]);
  const items = await fixture.loader.loadBuildChildren(job);

  assert.deepEqual(
    fixture.requests.map(({ limit, offset }) => ({ limit, offset })),
    [
      { limit: 20, offset: undefined },
      { limit: 40, offset: 0 }
    ]
  );
  assert.equal(items.filter((item) => item instanceof BuildTreeItem).length, 40);
  const loadMore = fixture.placeholders.at(-1);
  assert.equal(loadMore?.label, "Load 20 more builds");
  assert.equal(loadMore?.description, "Showing 40");
  assert.deepEqual(loadMore?.command, {
    command: "jenkinsWorkbench.loadMoreBuilds",
    title: "Load More Builds",
    arguments: [job]
  });
});

it("stops at the tree build cap and points to Open Build by Number", async () => {
  const fixture = createPagingFixture(1000);
  const job = fixture.job("demo");
  const clicks = (MAX_TREE_BUILDS - PAGE_SIZE) / PAGE_SIZE;
  for (let index = 0; index < clicks; index += 1) {
    assert.equal(fixture.loader.loadMoreBuilds(job), true);
  }
  assert.equal(fixture.loader.loadMoreBuilds(job), false);
  assert.equal(fixture.clearedKeys.length, clicks);

  await fixture.loader.loadBuildChildren(job);

  assert.equal(fixture.requests.at(-1)?.limit, MAX_TREE_BUILDS);
  const capped = fixture.placeholders.at(-1);
  assert.equal(capped?.label, `Showing the ${MAX_TREE_BUILDS} most recent builds`);
  assert.deepEqual(capped?.command, {
    command: "jenkinsWorkbench.openBuildByNumber",
    title: "Open Build by Number",
    arguments: [job]
  });
});

it("forgets the job paged least recently, with its cached list, once too many are remembered", async () => {
  const fixture = createPagingFixture(1000);
  const first = fixture.job("job-0");
  const firstKey = fixture.loader.buildBuildsChildrenKey(
    first.environment,
    first.jobUrl,
    first.jobScope
  );
  fixture.loader.loadMoreBuilds(first);
  for (let index = 1; index <= REQUESTED_BUILD_COUNTS_MAX_ENTRIES; index += 1) {
    fixture.loader.loadMoreBuilds(fixture.job(`job-${index}`));
  }
  const recent = fixture.job(`job-${REQUESTED_BUILD_COUNTS_MAX_ENTRIES}`);
  assert.equal(fixture.clearedKeys.filter((key) => key === firstKey).length, 2);

  await fixture.loader.loadBuildChildren(first);
  await fixture.loader.loadBuildChildren(recent);

  assert.deepEqual(
    fixture.requests.map(({ limit }) => limit),
    [PAGE_SIZE, PAGE_SIZE * 2]
  );
});

it("binds the load more row to the job item being expanded after a section reload replaces it", async () => {
  const fixture = createPagingFixture(1000);
  const firstRender = fixture.job("demo");
  const reloadedRender = fixture.job("demo");

  await fixture.loader.loadBuildChildren(firstRender);
  await fixture.loader.loadBuildChildren(reloadedRender);

  assert.equal(fixture.requests.length, 1);
  const [firstRow, reloadedRow] = fixture.placeholders.slice(-2);
  assert.ok(firstRow && reloadedRow);
  assert.equal((firstRow.command as { arguments: unknown[] }).arguments[0], firstRender);
  assert.equal((reloadedRow.command as { arguments: unknown[] }).arguments[0], reloadedRender);
  assert.equal(reloadedRow.description, "Showing 20");
});
