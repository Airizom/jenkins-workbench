import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { EnvironmentWithScope } from "../src/storage/JenkinsEnvironmentStore";
import { createThemeVscodeMock } from "./helpers/vscodeMocks";

class TestTreeItem {
  id?: string;
  contextValue?: string;
  description?: unknown;
  tooltip?: unknown;
  iconPath?: unknown;

  constructor(
    public label: unknown,
    public collapsibleState?: unknown
  ) {}
}

vi.doMock("vscode", () => ({
  ...createThemeVscodeMock(),
  TreeItem: TestTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }
}));

const { InstanceTreeItem, JobsFolderTreeItem } = await import("../src/tree/items/TreeRootItems");
const { createTreeElementChildrenHandler } = await import(
  "../src/tree/loader/TreeElementChildrenHandler"
);

const environment: EnvironmentWithScope = {
  id: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

describe("createTreeElementChildrenHandler", () => {
  it("matches its constructor and passes the inferred subtype to getChildren", async () => {
    const instance = new InstanceTreeItem(environment);
    const jobs = new JobsFolderTreeItem(instance);
    let environmentId: string | undefined;
    const handler = createTreeElementChildrenHandler(InstanceTreeItem, {
      getChildren: async (element) => {
        environmentId = element.environmentId;
        return [];
      }
    });

    assert.equal(handler.matches(instance), true);
    assert.equal(handler.matches(jobs), false);
    assert.deepEqual(await handler.getChildren?.(instance), []);
    assert.equal(environmentId, "env-1");
  });

  it("supports subtype-specific invalidate-only handlers", () => {
    const instance = new InstanceTreeItem(environment);
    let invalidatedEnvironmentId: string | undefined;
    const handler = createTreeElementChildrenHandler(InstanceTreeItem, {
      invalidate: (element) => {
        invalidatedEnvironmentId = element.environmentId;
      }
    });

    handler.invalidate?.(instance);

    assert.equal(handler.getChildren, undefined);
    assert.equal(invalidatedEnvironmentId, "env-1");
  });
});
