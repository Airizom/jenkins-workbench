import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { ArtifactTreeItem } from "../src/tree/items/TreeBuildItems";
import { JenkinsFolderTreeItem } from "../src/tree/items/TreeJobItems";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
import {
  ActivityFolderTreeItem,
  ActivityGroupTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem
} from "../src/tree/items/TreeRootItems";
import { buildActivityViewModel } from "../src/tree/activity/ActivityViewModelBuilder";
import { describeTreeLoadError } from "../src/tree/TreeLoadErrors";
import {
  formatJobFilterDescription,
  formatTreeViewSummary
} from "../src/tree/TreeViewPresentation";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

describe("formatTreeViewSummary", () => {
  it("hides the banner and badge when nothing is happening", () => {
    assert.deepEqual(
      formatTreeViewSummary({ running: 0, queue: 0, watchErrors: 0, hasData: true }),
      { message: undefined, badge: undefined }
    );
  });

  it("badges running jobs and lists only non-zero counts", () => {
    assert.deepEqual(
      formatTreeViewSummary({ running: 2, queue: 0, watchErrors: 0, hasData: true }),
      { message: undefined, badge: { value: 2, tooltip: "2 running" } }
    );
  });

  it("keeps the badge meaning stable when watch errors appear", () => {
    const presentation = formatTreeViewSummary({
      running: 1,
      queue: 3,
      watchErrors: 1,
      hasData: true
    });
    assert.deepEqual(presentation.badge, { value: 1, tooltip: "1 running • 3 queued" });
    assert.equal(presentation.message, "Could not check 1 watched job. Retrying on the next poll.");
  });
});

describe("formatJobFilterDescription", () => {
  it("names the active filter and stays empty when unfiltered", () => {
    assert.equal(formatJobFilterDescription("all"), undefined);
    assert.equal(formatJobFilterDescription("failing"), "Filter: failing jobs");
    assert.equal(formatJobFilterDescription("running"), "Filter: running jobs");
  });
});

describe("describeTreeLoadError", () => {
  it("classifies authentication failures", () => {
    const presentation = describeTreeLoadError(new JenkinsRequestError("Unauthorized", 401));
    assert.equal(presentation.issue, "auth");
    assert.equal(presentation.message, "Unauthorized");
    assert.ok(presentation.hint);
    const anonymous = new JenkinsRequestError("Forbidden", 403, undefined, {
      "x-you-are-authenticated-as": "anonymous"
    });
    assert.equal(describeTreeLoadError(anonymous).issue, "auth");
  });

  it("treats a signed-in user's missing permission as an item-level failure", () => {
    const forbidden = new JenkinsRequestError("Forbidden", 403, undefined, {
      "x-you-are-authenticated-as": "alice"
    });
    assert.equal(describeTreeLoadError(forbidden).issue, undefined);
    assert.equal(describeTreeLoadError(new JenkinsRequestError("Forbidden", 403)).issue, undefined);
  });

  it("classifies connection failures as unreachable", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    assert.equal(describeTreeLoadError(refused).issue, "unreachable");
  });

  it("does not flag the environment for one slow or reset request", () => {
    assert.equal(
      describeTreeLoadError(new JenkinsRequestError("Request timed out after 30000ms")).issue,
      undefined
    );
    const reset = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    assert.equal(describeTreeLoadError(reset).issue, undefined);
  });

  it("does not flag the whole environment for item-level failures", () => {
    assert.equal(describeTreeLoadError(new JenkinsRequestError("Not Found", 404)).issue, undefined);
    assert.equal(describeTreeLoadError("boom").message, "Unexpected error.");
  });
});

describe("root section items", () => {
  it("keeps labels plain and puts counts in descriptions", () => {
    const jobs = new JobsFolderTreeItem(environment, {
      total: 12,
      jobs: 5,
      pipelines: 4,
      folders: 3,
      running: 2,
      disabled: 0
    });
    const nodes = new NodesFolderTreeItem(environment, { total: 3, online: 3, offline: 0 });
    const queue = new BuildQueueFolderTreeItem(environment, { total: 0 });
    const pinned = new PinnedJobsFolderTreeItem(environment, 1);

    assert.equal(jobs.label, "Jobs");
    assert.equal(jobs.description, "12 items • 2 running");
    assert.equal(nodes.label, "Nodes");
    assert.equal(nodes.description, "3 online");
    assert.equal(queue.label, "Build Queue");
    assert.equal(queue.description, "Empty");
    assert.equal(pinned.description, "1 job");
  });

  it("marks truncated activity counts with a plus", () => {
    const activity = new ActivityFolderTreeItem(environment, {
      displayedTotal: 12,
      limit: 10,
      isTruncated: true,
      groups: [
        { kind: "failing", displayedCount: 10, isTruncated: true },
        { kind: "running", displayedCount: 2, isTruncated: false }
      ]
    });
    const failing = new ActivityGroupTreeItem(environment, "failing", 10, true);

    assert.equal(activity.label, "Activity");
    assert.equal(activity.description, "10+ failing • 2 running");
    assert.equal(failing.label, "Failing");
    assert.equal(failing.description, "10+");
  });
});

describe("InstanceTreeItem", () => {
  const stored = { id: "env-1", scope: "workspace" as const, url: "https://jenkins.example/" };

  it("shows the user so environments on one host can be told apart", () => {
    const item = new InstanceTreeItem({ ...stored, username: "alice" });
    assert.equal(item.description, "Workspace • alice");
  });

  it("surfaces an environment-wide issue on the row", () => {
    const item = new InstanceTreeItem(stored, { kind: "auth", message: "Unauthorized" });
    assert.equal(item.description, "Sign-in failed • Workspace");
    assert.match(String(item.tooltip), /Sign-in failed: Unauthorized/);
  });
});

describe("PlaceholderTreeItem retry", () => {
  it("attaches a retry command to error placeholders only once", () => {
    const error = new PlaceholderTreeItem("Unable to load jobs.", "Forbidden", "error");
    const retry = { command: "jenkinsWorkbench.refresh", title: "Retry" };
    error.attachRetryCommand(retry);
    error.attachRetryCommand({ command: "other", title: "Other" });
    assert.equal(error.command, retry);
    assert.match(String(error.tooltip), /Click to retry\.$/);

    const empty = new PlaceholderTreeItem("No builds found.");
    empty.attachRetryCommand(retry);
    assert.equal(empty.command, undefined);
  });
});

describe("ArtifactTreeItem", () => {
  it("previews text artifacts on click and uses the file icon theme", () => {
    const item = new ArtifactTreeItem(environment, "b", 1, "reports/out.log", "out.log");
    assert.equal(
      (item.command as { command: string } | undefined)?.command,
      "jenkinsWorkbench.previewArtifact"
    );
    assert.equal((item.resourceUri as { path: string }).path, "/reports/out.log");
  });

  it("does not pull binary archives into an editor on click", () => {
    const item = new ArtifactTreeItem(environment, "b", 1, "dist/app.jar", "app.jar");
    assert.equal(item.command, undefined);
    assert.match(String(item.tooltip), /Download/);
  });
});

describe("multibranch folder context", () => {
  it("only exposes Clear Branch Filter when a filter is set", () => {
    const url = "https://jenkins.example/job/repo/";
    const plain = new JenkinsFolderTreeItem(environment, "repo", url, "multibranch");
    const filtered = new JenkinsFolderTreeItem(environment, "repo", url, "multibranch", undefined, {
      branchFilter: "main"
    });
    assert.equal(plain.contextValue, "multibranchFolder");
    assert.equal(filtered.contextValue, "multibranchFolder branchFiltered");
  });
});

describe("activity job names", () => {
  it("decodes multibranch branch names", () => {
    const url = "https://jenkins.example/job/repo/job/feature%252Fsmoke/";
    const viewModel = buildActivityViewModel(
      new Map([
        [
          "unstable",
          [
            {
              name: "feature%2Fsmoke",
              url,
              kind: "pipeline",
              fullName: "repo/feature%2Fsmoke",
              path: [
                { name: "repo", url: "https://jenkins.example/job/repo/", kind: "multibranch" },
                { name: "feature%2Fsmoke", url, kind: "pipeline" }
              ]
            }
          ]
        ]
      ]),
      10
    );
    assert.equal(viewModel.groups[0]?.items[0]?.name, "feature/smoke");
  });
});
