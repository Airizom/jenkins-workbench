import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it, vi } from "vitest";
import type { WorkbenchTreeElement } from "../src/tree/TreeItems";
import * as vscodeStub from "./helpers/vscodeStub";

const contextValues = new Map<string, boolean>();
vi.doMock("vscode", () => ({
  ...vscodeStub,
  commands: {
    executeCommand: async (command: string, key: string, value: boolean) => {
      assert.equal(command, "setContext");
      contextValues.set(key, value);
    }
  }
}));

const { TreeBulkSelection } = await import("../src/commands/bulk/TreeBulkSelection");
const { BuildTreeItem, JobTreeItem, QueueItemTreeItem, StalePinnedJobTreeItem } = await import(
  "../src/tree/TreeItems"
);

const environment = {
  environmentId: "test",
  scope: "workspace" as const,
  url: "https://jenkins.example/"
};

function job(name: string, isWatched = false, isPinned = false) {
  return new JobTreeItem({
    environment,
    label: name,
    jobUrl: `${environment.url}job/${name}/`,
    variant: "default",
    presentation: "job",
    isWatched,
    isPinned
  });
}

function fixture(initialSelection: readonly WorkbenchTreeElement[] = []) {
  const selectionChanges = new vscodeStub.EventEmitter<{
    selection: readonly WorkbenchTreeElement[];
  }>();
  const treeChanges = new vscodeStub.EventEmitter<
    WorkbenchTreeElement | WorkbenchTreeElement[] | null | undefined
  >();
  const view = {
    selection: initialSelection,
    onDidChangeSelection: selectionChanges.event
  };
  const service = new TreeBulkSelection(view, { onDidChangeTreeData: treeChanges.event });
  return {
    service,
    view,
    select(selection: readonly WorkbenchTreeElement[]) {
      view.selection = selection;
      selectionChanges.fire({ selection });
    },
    refresh() {
      treeChanges.fire(undefined);
    }
  };
}

function context(action: string): boolean | undefined {
  return contextValues.get(`jenkinsWorkbench.bulkSelection.${action}`);
}

describe("TreeBulkSelection", () => {
  it("snapshots palette selection and preserves explicit single-item calls", () => {
    const first = job("first");
    const second = job("second");
    const f = fixture([first, second]);
    const snapshot = f.service.resolve();
    assert.deepEqual(snapshot, [first, second]);
    assert.notEqual(snapshot, f.view.selection);
    assert.deepEqual(f.service.resolve(first), [first]);
    f.select([second]);
    assert.deepEqual(snapshot, [first, second]);
    f.service.dispose();
  });

  it("uses menu selection only when it contains the clicked row", () => {
    const first = job("first");
    const second = job("second");
    const outside = job("outside");
    const f = fixture([first, second]);
    assert.deepEqual(f.service.resolve(first, [first, second]), [first, second]);
    assert.deepEqual(f.service.resolve(outside, [first, second]), [outside]);
    // VS Code can retain an equivalent tree row across a provider refresh.
    assert.deepEqual(f.service.resolve(job("first"), [first, second]), [first, second]);
    assert.deepEqual(f.service.resolve(first, []), [first]);
    f.service.dispose();
  });

  it("exposes both add and remove actions for mixed watched and pinned states", () => {
    const f = fixture([job("plain"), job("tracked", true, true)]);
    for (const action of ["multiple", "watch", "unwatch", "pin", "unpin"]) {
      assert.equal(context(action), true, action);
    }
    assert.equal(context("stop"), false);
    assert.equal(context("cancel"), false);
    f.select([job("tracked", true, true)]);
    assert.equal(context("multiple"), false);
    assert.equal(context("watch"), true);
    assert.equal(context("pin"), true);
    assert.equal(context("unwatch"), true);
    assert.equal(context("unpin"), true);
    f.service.dispose();
  });

  it("keeps explicit actions available when rows are replaced under selected handles", () => {
    const initial = [job("first"), job("second")];
    const f = fixture(initial);
    // Provider change arrives before VS Code asynchronously replaces its selected row
    // objects; stable handles mean that replacement does not emit a selection event.
    f.refresh();
    const replacement = [job("first", true, true), job("second", true, true)];
    assert.deepEqual(
      replacement.map((item) => item.id),
      initial.map((item) => item.id)
    );
    f.view.selection = replacement;
    for (const action of ["multiple", "watch", "unwatch", "pin", "unpin"]) {
      assert.equal(context(action), true, action);
    }
    assert.deepEqual(f.service.resolve(), replacement);
    f.service.dispose();
  });

  it("refreshes running, queue, and stale pin eligibility and disposes listeners", () => {
    const running = new BuildTreeItem(environment, {
      number: 5,
      url: `${environment.url}job/demo/5/`,
      building: true
    });
    const queued = new QueueItemTreeItem(environment, { id: 1, name: "demo", position: 1 });
    const stale = new StalePinnedJobTreeItem(environment, "old", `${environment.url}job/old/`);
    const f = fixture([running, queued, stale]);
    assert.equal(context("stop"), true);
    assert.equal(context("cancel"), true);
    assert.equal(context("unpin"), true);
    assert.equal(context("watch"), false);
    assert.equal(context("pin"), false);
    f.view.selection = [stale];
    f.refresh();
    assert.equal(context("stop"), false);
    assert.equal(context("cancel"), false);
    assert.equal(context("unpin"), true);
    f.service.dispose();
    f.select([running, queued]);
    f.refresh();
    for (const action of ["multiple", "stop", "cancel", "watch", "unwatch", "pin", "unpin"]) {
      assert.equal(context(action), false, action);
    }
  });
});

describe("bulk action menus", () => {
  it("keeps inline commands separate and exposes all six context commands", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const menus = manifest.contributes.menus;
    const actions = [
      "abortBuild",
      "cancelQueueItem",
      "watchJob",
      "unwatchJob",
      "pinJob",
      "unpinJob"
    ];
    for (const action of actions) {
      const id = `jenkinsWorkbench.${action}`;
      const entries = menus["view/item/context"].filter(
        (entry: { command: string }) => entry.command === id
      );
      assert.equal(entries.length, 1, id);
      assert.ok(!entries[0].group.startsWith("inline"), id);
      assert.match(entries[0].when, /jenkinsWorkbench\.bulkSelection\.multiple/);
    }
    for (const action of ["abortBuild", "cancelQueueItem", "pinJob", "unpinJob"]) {
      const id = `jenkinsWorkbench.${action}.single`;
      assert.ok(
        menus["view/item/context"].some(
          (entry: { command: string; group: string }) =>
            entry.command === id && entry.group.startsWith("inline")
        )
      );
      assert.ok(
        menus.commandPalette.some(
          (entry: { command: string; when: string }) =>
            entry.command === id && entry.when === "false"
        )
      );
    }
  });
});
