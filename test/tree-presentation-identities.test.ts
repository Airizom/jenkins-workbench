import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsBuild } from "../src/jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildTreeItem } from "../src/tree/items/TreeBuildItems";
import { JobTreeItem } from "../src/tree/items/TreeJobItems";
import { buildEnvironmentTreeItemId } from "../src/tree/items/TreeItemIds";
import { WorkspaceRootTreeItem } from "../src/tree/items/TreeWorkspaceItems";
import { buildBuildsChildrenKey } from "../src/tree/loader/TreeChildrenMapping";
import { ROOT_TREE_JOB_SCOPE, withTreeJobPresentation } from "../src/tree/TreeJobScope";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

const jobUrl = "https://jenkins.example/job/demo/";
const build: JenkinsBuild = {
  number: 42,
  url: `${jobUrl}42/`,
  result: "SUCCESS"
};

describe("alternate job presentation identities", () => {
  it("preserves all presentation and variant combinations", () => {
    const cases = [
      {
        variant: "default" as const,
        color: "blue_anime",
        isWatched: true,
        isPinned: true,
        scope: ROOT_TREE_JOB_SCOPE,
        contextFlags: "pinned watched enabled",
        description: "Running • Pinned • Watched",
        tooltip: undefined,
        iconColor: "charts.blue"
      },
      {
        variant: "quickAccess" as const,
        color: "red",
        isWatched: true,
        scope: withTreeJobPresentation(ROOT_TREE_JOB_SCOPE, "pinned"),
        contextFlags: "pinned watched enabled",
        description: "Failed • Watched",
        tooltip: "demo\nFailed • Watched",
        iconColor: "charts.red"
      },
      {
        variant: "activity" as const,
        group: "running" as const,
        pathContext: "team / demo",
        color: "disabled",
        isWatched: true,
        isPinned: true,
        scope: withTreeJobPresentation(ROOT_TREE_JOB_SCOPE, "activity:running"),
        contextFlags: "pinned watched disabled",
        description: "team / demo • Disabled • Pinned • Watched",
        tooltip: `demo\nteam / demo\nteam / demo • Disabled • Pinned • Watched\n${jobUrl}`,
        iconColor: "charts.gray"
      }
    ];

    for (const presentation of ["job", "pipeline"] as const) {
      for (const testCase of cases) {
        const item = new JobTreeItem({
          presentation,
          environment,
          label: "demo",
          jobUrl,
          ...testCase
        });
        const icon = item.iconPath as { id: string; color?: { id: string } };

        assert.equal(item.presentation, presentation);
        assert.deepEqual(item.jobScope, testCase.scope);
        assert.equal(
          item.id,
          buildEnvironmentTreeItemId(presentation, environment, testCase.scope, jobUrl)
        );
        assert.equal(
          item.contextValue,
          `${presentation === "pipeline" ? "pipelineItem" : "jobItem"} ${testCase.contextFlags}`
        );
        assert.equal(item.description, testCase.description);
        assert.equal(item.tooltip, testCase.tooltip);
        assert.equal(icon.id, presentation === "pipeline" ? "symbol-structure" : "gear");
        assert.equal(icon.color?.id, testCase.iconColor);
      }
    }
  });

  it("namespaces descendant ids and child caches by the parent presentation", () => {
    const jobsItem = new JobTreeItem({
      presentation: "job",
      variant: "default",
      environment,
      label: "demo",
      jobUrl
    });
    const pinnedItem = new JobTreeItem({
      presentation: "job",
      variant: "quickAccess",
      environment,
      label: "demo",
      jobUrl
    });
    const activityItem = new JobTreeItem({
      presentation: "job",
      variant: "activity",
      environment,
      label: "demo",
      jobUrl,
      color: "blue_anime",
      isPinned: true,
      group: "running"
    });
    const parents = [jobsItem, pinnedItem, activityItem];

    const cacheKeys = parents.map((parent) =>
      buildBuildsChildrenKey(
        (kind, _environment, extra) => `${kind}:${extra ?? ""}`,
        environment,
        jobUrl,
        parent.jobScope
      )
    );
    const buildIds = parents.map(
      (parent) => new BuildTreeItem(environment, build, parent.jobScope).id
    );
    const workspaceIds = parents.map(
      (parent) => new WorkspaceRootTreeItem(environment, jobUrl, parent.jobScope).id
    );

    assert.equal(new Set(cacheKeys).size, parents.length);
    assert.equal(new Set(buildIds).size, parents.length);
    assert.equal(new Set(workspaceIds).size, parents.length);
  });
});
