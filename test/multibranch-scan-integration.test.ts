import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { MultibranchScanState } from "../src/services/multibranchScan/MultibranchScanState";
import * as baseVscode from "./helpers/vscodeStub";

const info = vi.fn(
  async (_message: string, ..._actions: string[]) => undefined as string | undefined
);
const warning = vi.fn(
  async (_message: string, ..._actions: string[]) => undefined as string | undefined
);
const execute = vi.fn(async (..._args: unknown[]) => undefined);
const openExternal = vi.fn(async () => true);
vi.doMock("vscode", () => ({
  ...baseVscode,
  window: { showInformationMessage: info, showWarningMessage: warning },
  commands: { executeCommand: execute },
  env: { openExternal }
}));
const { completeMultibranchScan, notifyMultibranchScan } = await import(
  "../src/services/multibranchScan/MultibranchScanNotifications"
);
const { decorateMultibranchScanItem } = await import("../src/tree/MultibranchScanPresentation");
const { JenkinsFolderTreeItem } = await import("../src/tree/items/TreeJobItems");
const target = {
  environment: { environmentId: "local", scope: "workspace" as const, url: "https://ci.example/" },
  folderUrl: "https://ci.example/job/project/",
  label: "project"
};
function state(overrides: Partial<MultibranchScanState> = {}): MultibranchScanState {
  return {
    target,
    phase: "completed",
    outcome: "success",
    observedAt: 1000,
    generation: 1,
    logRevision: 0,
    ...overrides
  };
}
beforeEach(() => vi.clearAllMocks());

describe("multibranch scan completion integration", () => {
  it("refreshes branches and current-branch resolution before offering completion actions", async () => {
    const calls: string[] = [];
    const fullEnvironmentRefresh = vi.fn((request: unknown) => {
      calls.push("tree");
      assert.deepEqual(request, { environmentId: "local", trigger: "system" });
      return { executed: true };
    });
    info.mockImplementationOnce(async () => {
      calls.push("notification");
      return undefined;
    });
    await completeMultibranchScan(state(), { fullEnvironmentRefresh }, async () => {
      calls.push("currentBranch");
    });
    assert.deepEqual(calls, ["tree", "currentBranch", "notification"]);
    assert.equal(fullEnvironmentRefresh.mock.calls.length, 1);
    assert.deepEqual(info.mock.calls[0], [
      "Scan completed: success for project.",
      "View Scan Log",
      "Open in Jenkins"
    ]);
  });

  it("refreshes partial branch discoveries and warns when indexing fails", async () => {
    const refresh = vi.fn(() => ({ executed: true }));
    await completeMultibranchScan(
      state({ outcome: "failure" }),
      { fullEnvironmentRefresh: refresh },
      async () => {}
    );
    assert.equal(refresh.mock.calls.length, 1);
    assert.match(warning.mock.calls[0][0], /completed: failure/);
  });

  it("reports completion even when current-branch refresh fails", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await completeMultibranchScan(
        state(),
        { fullEnvironmentRefresh: () => ({ executed: true }) },
        async () => {
          throw new Error("offline");
        }
      );
      assert.equal(info.mock.calls.length, 1);
      assert.equal(logged.mock.calls.length, 1);
    } finally {
      logged.mockRestore();
    }
  });

  it("opens logs only when the notification action is selected", async () => {
    await notifyMultibranchScan(state({ phase: "queued", outcome: undefined }));
    assert.equal(execute.mock.calls.length, 0);
    info.mockResolvedValueOnce("View Scan Log");
    await notifyMultibranchScan(state());
    assert.deepEqual(execute.mock.calls[0], ["jenkinsWorkbench.viewMultibranchScanLog", target]);
  });

  it("offers the indexing page when status cannot be established", async () => {
    warning.mockResolvedValueOnce("Open in Jenkins");
    await notifyMultibranchScan(
      state({ phase: "unavailable", outcome: undefined, detail: "Tracking stopped." })
    );
    assert.match(warning.mock.calls[0][0], /Tracking stopped/);
    assert.equal(openExternal.mock.calls.length, 1);
  });
});

describe("multibranch scan tree presentation", () => {
  it("preserves filters, identity and cached item values without accumulating status suffixes", () => {
    const item = new JenkinsFolderTreeItem(
      target.environment,
      target.label,
      target.folderUrl,
      "multibranch",
      undefined,
      { branchFilter: "feature/*" }
    );
    const before = {
      description: item.description,
      tooltip: item.tooltip,
      contextValue: item.contextValue
    };
    const first = decorateMultibranchScanItem(
      item,
      state({ phase: "running", outcome: undefined })
    );
    const finished = decorateMultibranchScanItem(item, state());
    assert.equal(first.description, "Multibranch • Filtered • Scan running");
    assert.equal(finished.description, "Multibranch • Filtered • Scan completed: success");
    assert.equal(first.id, item.id);
    assert.equal(first.contextValue, before.contextValue);
    assert.match(String(first.tooltip), /Branch filter: feature\/\*/);
    assert.match(first.accessibilityInformation?.label ?? "", /project.*Filtered.*Scan running/);
    assert.deepEqual(
      { description: item.description, tooltip: item.tooltip, contextValue: item.contextValue },
      before
    );
  });

  it("exposes tracking errors without replacing a known running state", () => {
    const item = new JenkinsFolderTreeItem(
      target.environment,
      target.label,
      target.folderUrl,
      "multibranch"
    );
    const result = decorateMultibranchScanItem(
      item,
      state({ phase: "running", logError: "403 Forbidden" })
    );
    assert.match(String(result.description), /Scan running/);
    assert.match(String(result.tooltip), /Log unavailable: 403 Forbidden/);
  });
});

const { resolveMultibranchScanTarget } = await import(
  "../src/services/multibranchScan/MultibranchScanTargetResolver"
);
describe("scan notification target resolution", () => {
  it("rebases a retained target and uses the latest environment policy", async () => {
    const current = {
      id: "local",
      scope: "workspace" as const,
      url: "https://new-ci.example/jenkins/",
      previousUrls: [target.environment.url],
      name: "Renamed",
      allowInsecureTls: false
    };
    const resolved = await resolveMultibranchScanTarget(
      { ...target, environment: { ...target.environment, allowInsecureTls: true } },
      { listEnvironmentsWithScope: async () => [current] }
    );
    assert.equal(resolved.folderUrl, "https://new-ci.example/jenkins/job/project/");
    assert.equal(resolved.environment.url, current.url);
    assert.equal(resolved.environment.name, "Renamed");
    assert.notEqual(resolved.environment.allowInsecureTls, true);
  });
  it("does not reconnect an old notification to a removed environment", async () => {
    await assert.rejects(
      resolveMultibranchScanTarget(target, { listEnvironmentsWithScope: async () => [] }),
      /no longer exists/
    );
  });
  it("rejects a folder outside the current environment and its recorded URL history", async () => {
    await assert.rejects(
      resolveMultibranchScanTarget(target, {
        listEnvironmentsWithScope: async () => [
          { id: "local", scope: "workspace", url: "https://different.example/" }
        ]
      }),
      /URL changed/
    );
  });
});
