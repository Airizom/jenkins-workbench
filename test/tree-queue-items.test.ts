import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
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

const vscodeShim = {
  ...createThemeVscodeMock(),
  TreeItem: TestTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }
};

vi.doMock("vscode", () => vscodeShim);
const { QueueItemTreeItem } = await import("../src/tree/items/TreeQueueItems");

describe("QueueItemTreeItem", () => {
  it("uses Jenkins queue ids in stable tree item ids", () => {
    const environment: JenkinsEnvironmentRef = {
      environmentId: "env-1",
      scope: "workspace",
      url: "https://jenkins.example/"
    };

    const first = new QueueItemTreeItem(environment, {
      id: 101,
      name: "demo",
      position: 1
    });
    const second = new QueueItemTreeItem(environment, {
      id: 102,
      name: "demo",
      position: 2
    });

    assert.equal(first.id, "queue-item:workspace:env-1:101");
    assert.equal(second.id, "queue-item:workspace:env-1:102");
    assert.notEqual(first.id, second.id);
  });
});
