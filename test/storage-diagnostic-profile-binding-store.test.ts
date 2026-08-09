import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type * as vscode from "vscode";
import {
  JenkinsDiagnosticProfileBindingStore,
  normalizeDiagnosticJobScopeUrl
} from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import { createExtensionContext } from "./helpers/storageMocks";

class AsyncMemento {
  private readonly storage = new Map<string, unknown>();
  failNextUpdate = false;

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error("update failed");
    }
    this.storage.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.storage.keys()];
  }
}

describe("JenkinsDiagnosticProfileBindingStore", () => {
  it("stores bindings by scope, normalized job URL, and repository URI", async () => {
    const store = new JenkinsDiagnosticProfileBindingStore(createExtensionContext());
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    const workspaceBinding = await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project?view=all#top",
      repositoryUri: "file:///workspace/project",
      profileId: "  strict  ",
      enabled: true
    });
    await store.setBinding("global", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project/",
      repositoryUri: "file:///workspace/project",
      enabled: false
    });

    assert.equal(workspaceBinding.jobScopeUrl, "https://jenkins.example/job/project/");
    assert.equal(workspaceBinding.profileId, "strict");
    assert.equal(workspaceBinding.enabled, true);
    assert.ok(workspaceBinding.updatedAt > 0);
    assert.equal(changes, 2);
    assert.equal(store.listBindings().length, 2);
    assert.equal(
      store.getBinding(
        "workspace",
        "env-1",
        "https://jenkins.example/job/project",
        "file:///workspace/project"
      )?.profileId,
      "strict"
    );
    assert.equal(
      store.getBinding(
        "global",
        "env-1",
        "https://jenkins.example/job/project",
        "file:///workspace/project"
      )?.enabled,
      false
    );
  });

  it("lists all repository bindings for a normalized job scope", async () => {
    const store = new JenkinsDiagnosticProfileBindingStore(createExtensionContext());
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project/",
      repositoryUri: "file:///workspace/a",
      enabled: true
    });
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project",
      repositoryUri: "file:///workspace/b",
      profileId: "custom",
      enabled: true
    });
    await store.setBinding("workspace", {
      environmentId: "env-2",
      jobScopeUrl: "https://jenkins.example/job/project/",
      repositoryUri: "file:///workspace/c",
      enabled: true
    });

    const bindings = store.findBindingsForJob(
      "workspace",
      "env-1",
      "https://jenkins.example/job/project"
    );
    assert.deepEqual(bindings.map((binding) => binding.repositoryUri).sort(), [
      "file:///workspace/a",
      "file:///workspace/b"
    ]);
  });

  it("updates an existing composite-key binding without creating a duplicate", async () => {
    const store = new JenkinsDiagnosticProfileBindingStore(createExtensionContext());
    const original = await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project/",
      repositoryUri: "file:///workspace/project",
      enabled: true
    });
    const updated = await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/project",
      repositoryUri: "file:///workspace/project",
      profileId: "strict",
      enabled: false
    });

    assert.equal(store.listBindings().length, 1);
    assert.equal(updated.profileId, "strict");
    assert.equal(updated.enabled, false);
    assert.ok(updated.updatedAt > original.updatedAt);
  });

  it("updates job URLs and keeps an existing newer target binding on collision", async () => {
    const store = new JenkinsDiagnosticProfileBindingStore(createExtensionContext());
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/old/",
      repositoryUri: "file:///workspace/a",
      profileId: "old-profile",
      enabled: true
    });
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/new/",
      repositoryUri: "file:///workspace/a",
      profileId: "new-profile",
      enabled: false
    });
    await store.setBinding("workspace", {
      environmentId: "env-1",
      jobScopeUrl: "https://jenkins.example/job/old/",
      repositoryUri: "file:///workspace/b",
      enabled: true
    });

    assert.equal(
      await store.updateBindingUrl(
        "workspace",
        "env-1",
        "https://jenkins.example/job/old",
        "https://jenkins.example/job/new"
      ),
      true
    );

    const bindings = store.findBindingsForJob(
      "workspace",
      "env-1",
      "https://jenkins.example/job/new"
    );
    assert.equal(bindings.length, 2);
    assert.equal(
      bindings.find((binding) => binding.repositoryUri.endsWith("/a"))?.profileId,
      "new-profile"
    );
    assert.equal(
      store.findBindingsForJob("workspace", "env-1", "https://jenkins.example/job/old").length,
      0
    );
  });

  it("removes one binding, all job bindings, and all environment bindings", async () => {
    const store = new JenkinsDiagnosticProfileBindingStore(createExtensionContext());
    for (const [jobScopeUrl, repositoryUri] of [
      ["https://jenkins.example/job/a/", "file:///workspace/a"],
      ["https://jenkins.example/job/a/", "file:///workspace/b"],
      ["https://jenkins.example/job/b/", "file:///workspace/a"]
    ] as const) {
      await store.setBinding("workspace", {
        environmentId: "env-1",
        jobScopeUrl,
        repositoryUri,
        enabled: true
      });
    }
    await store.setBinding("workspace", {
      environmentId: "env-2",
      jobScopeUrl: "https://jenkins.example/job/a/",
      repositoryUri: "file:///workspace/a",
      enabled: true
    });

    assert.equal(
      await store.removeBinding(
        "workspace",
        "env-1",
        "https://jenkins.example/job/a",
        "file:///workspace/a"
      ),
      true
    );
    assert.equal(
      await store.removeBindingsForJob("workspace", "env-1", "https://jenkins.example/job/a"),
      true
    );
    assert.equal(await store.removeBindingsForEnvironment("workspace", "env-1"), true);
    assert.deepEqual(
      store.listBindings().map((binding) => binding.environmentId),
      ["env-2"]
    );
  });

  it("serializes concurrent mutations and does not emit failed writes", async () => {
    const workspaceState = new AsyncMemento();
    const context = createExtensionContext({
      workspaceState: workspaceState as unknown as vscode.Memento
    });
    const store = new JenkinsDiagnosticProfileBindingStore(context);
    let changes = 0;
    store.onDidChange(() => {
      changes += 1;
    });

    await Promise.all([
      store.setBinding("workspace", {
        environmentId: "env-1",
        jobScopeUrl: "https://jenkins.example/job/a/",
        repositoryUri: "file:///workspace/a",
        enabled: true
      }),
      store.setBinding("workspace", {
        environmentId: "env-1",
        jobScopeUrl: "https://jenkins.example/job/b/",
        repositoryUri: "file:///workspace/b",
        enabled: true
      })
    ]);
    assert.equal(store.listBindings().length, 2);
    assert.equal(changes, 2);

    workspaceState.failNextUpdate = true;
    await assert.rejects(
      store.setBinding("workspace", {
        environmentId: "env-1",
        jobScopeUrl: "https://jenkins.example/job/c/",
        repositoryUri: "file:///workspace/c",
        enabled: true
      })
    );
    assert.equal(store.listBindings().length, 2);
    assert.equal(changes, 2);
  });
});

describe("normalizeDiagnosticJobScopeUrl", () => {
  it("normalizes URL syntax and strips query and fragment data", () => {
    assert.equal(
      normalizeDiagnosticJobScopeUrl("HTTPS://JENKINS.EXAMPLE:443/job/team%20one?x=1#fragment"),
      "https://jenkins.example/job/team%20one/"
    );
  });
});
