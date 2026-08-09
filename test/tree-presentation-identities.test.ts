import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsBuild } from "../src/jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { BuildTreeItem } from "../src/tree/items/TreeBuildItems";
import {
  ActivityJobTreeItem,
  ActivityPipelineTreeItem,
  JobTreeItem,
  PipelineTreeItem,
  QuickAccessJobTreeItem,
  QuickAccessPipelineTreeItem
} from "../src/tree/items/TreeJobItems";
import { buildEnvironmentTreeItemId } from "../src/tree/items/TreeItemIds";
import { WorkspaceRootTreeItem } from "../src/tree/items/TreeWorkspaceItems";
import { buildBuildsChildrenKey } from "../src/tree/loader/TreeChildrenMapping";

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
  it("uses the job scope as the sole presentation discriminator", () => {
    const items = [
      new QuickAccessJobTreeItem(environment, "demo", jobUrl),
      new QuickAccessPipelineTreeItem(environment, "demo", jobUrl),
      new ActivityJobTreeItem(environment, "demo", jobUrl),
      new ActivityPipelineTreeItem(environment, "demo", jobUrl)
    ];

    for (const item of items) {
      const kind =
        item instanceof QuickAccessPipelineTreeItem || item instanceof ActivityPipelineTreeItem
          ? "pipeline"
          : "job";
      assert.equal(item.id, buildEnvironmentTreeItemId(kind, environment, item.jobScope, jobUrl));
    }

    assert.ok(items[0] instanceof JobTreeItem);
    assert.ok(items[1] instanceof PipelineTreeItem);
    assert.ok(items[2] instanceof JobTreeItem);
    assert.ok(items[3] instanceof PipelineTreeItem);
  });

  it("namespaces descendant ids and child caches by the parent presentation", () => {
    const jobsItem = new JobTreeItem(environment, "demo", jobUrl);
    const pinnedItem = new QuickAccessJobTreeItem(environment, "demo", jobUrl);
    const activityItem = new ActivityJobTreeItem(
      environment,
      "demo",
      jobUrl,
      undefined,
      "blue_anime",
      false,
      true,
      "running"
    );
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
