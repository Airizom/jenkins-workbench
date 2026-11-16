import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { HistoryBaselineStore } from "../src/history/HistoryBaseline";
import { EnvironmentUrlRebaseService } from "../src/services/EnvironmentUrlRebaseService";
import type { EnvironmentRecordsRef } from "../src/storage/EnvironmentRecordCopy";
import { type CommitWatch, JenkinsCommitWatchStore } from "../src/storage/JenkinsCommitWatchStore";
import { JenkinsDiagnosticProfileBindingStore } from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import { JenkinsRepositoryLinkStore } from "../src/storage/JenkinsRepositoryLinkStore";
import { JenkinsViewStateStore } from "../src/storage/JenkinsViewStateStore";
import { JenkinsWatchStore, type WatchedJobEntry } from "../src/storage/JenkinsWatchStore";
import { copyJenkinsfileEnvironmentSelections } from "../src/validation/JenkinsfileEnvironmentResolver";
import { WatchRuntimeStateStore } from "../src/watch/WatchRuntimeStateStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

const URL = "https://ci.example/";
const MANUAL_GLOBAL: EnvironmentRecordsRef = { scope: "global", environmentId: "manual" };
const DECLARED_GLOBAL: EnvironmentRecordsRef = { scope: "global", environmentId: "settings:ci" };
const DECLARED_WORKSPACE: EnvironmentRecordsRef = {
  scope: "workspace",
  environmentId: "settings:ci"
};

describe("copyEnvironmentRecords on scoped job stores", () => {
  it("copies pins into the target scope under the new id, once", async () => {
    const context = createExtensionContext();
    const store = new JenkinsPinStore(context);
    await store.addPin("global", { environmentId: "manual", jobUrl: `${URL}job/a/`, jobName: "a" });
    await store.addPin("global", { environmentId: "other", jobUrl: `${URL}job/b/` });

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(context.workspaceState.get("jenkinsWorkbench.pinnedJobs")).toEqual([
      { environmentId: "settings:ci", jobUrl: `${URL}job/a/`, jobName: "a" }
    ]);
    // The source stays intact.
    expect(await store.listPinnedJobsForEnvironment("global", "manual")).toHaveLength(1);

    const again = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(again.copied).toBe(0);
    expect(await store.listPinnedJobsForEnvironment("workspace", "settings:ci")).toHaveLength(1);

    await copy.undo();
    expect(await store.listPinnedJobsForEnvironment("workspace", "settings:ci")).toEqual([]);
    expect(await store.listPinnedJobsForEnvironment("global", "manual")).toHaveLength(1);
  });

  it("keeps a watch the target already has and undoes only the copied ones", async () => {
    const context = createExtensionContext();
    const store = new JenkinsWatchStore(context);
    await store.addWatch("global", {
      environmentId: "manual",
      jobUrl: `${URL}job/a/`,
      lastStatus: "failure"
    });
    await store.addWatch("global", { environmentId: "manual", jobUrl: `${URL}job/b/` });
    await store.addWatch("global", {
      environmentId: "settings:ci",
      jobUrl: `${URL}job/a/`,
      lastStatus: "success"
    });

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_GLOBAL);
    expect(copy.copied).toBe(1);
    const declared = (await store.listWatchedJobs()).filter(
      (entry) => entry.environmentId === "settings:ci"
    );
    expect(declared.map((entry) => [entry.jobUrl, entry.lastStatus])).toEqual([
      [`${URL}job/a/`, "success"],
      [`${URL}job/b/`, undefined]
    ]);

    await copy.undo();
    expect(
      (await store.listWatchedJobs())
        .filter((entry) => entry.environmentId === "settings:ci")
        .map((entry) => entry.jobUrl)
    ).toEqual([`${URL}job/a/`]);
  });
});

describe("WatchRuntimeStateStore.copyEnvironmentRecords", () => {
  it("copies failure counts and pending input state under the target key", async () => {
    const store = new WatchRuntimeStateStore();
    const source: WatchedJobEntry = { scope: "global", environmentId: "manual", jobUrl: "j/" };
    const target: WatchedJobEntry = { ...source, scope: "workspace", environmentId: "settings:ci" };
    const state = store.getOrCreate(source);
    state.failureCount = 3;
    state.pendingInput = { buildUrl: "b/", signature: "sig" };

    const copy = store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(store.get(target)).toEqual({
      failureCount: 3,
      pendingInput: { buildUrl: "b/", signature: "sig" }
    });
    expect(store.get(target)).not.toBe(state);
    expect(store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE).copied).toBe(0);
    expect(store.countErrors(3)).toBe(2);

    await copy.undo();
    expect(store.get(target)).toBeUndefined();
    expect(store.get(source)).toBe(state);
  });
});

describe("JenkinsParameterPresetStore.copyEnvironmentRecords", () => {
  it("stores copied secrets under new keys so removing the source keeps them", async () => {
    const secrets = createFakeSecretStorage();
    const context = createExtensionContext({ secrets });
    const store = new JenkinsParameterPresetStore(context);
    const jobUrl = `${URL}job/a/`;
    const saved = await store.savePreset("global", "manual", jobUrl, {
      name: "Release",
      values: { BRANCH: "main" },
      secretValues: { TOKEN: "s3cret" }
    });
    expect(secrets.values.size).toBe(1);

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(secrets.values.size).toBe(2);
    expect((await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE)).copied).toBe(0);

    await store.removePresetsForEnvironment("global", "manual");
    expect(await store.getPreset("workspace", "settings:ci", jobUrl, saved.id)).toMatchObject({
      name: "Release",
      values: { BRANCH: "main", TOKEN: "s3cret" }
    });

    await copy.undo();
    expect(await store.listPresets("workspace", "settings:ci", jobUrl)).toEqual([]);
    expect(secrets.values.size).toBe(0);
  });

  it("renames a copied preset whose name is taken at the target", async () => {
    const context = createExtensionContext();
    const store = new JenkinsParameterPresetStore(context);
    const jobUrl = `${URL}job/a/`;
    await store.savePreset("global", "manual", jobUrl, { name: "Release", values: {} });
    await store.savePreset("global", "settings:ci", jobUrl, { name: "release", values: {} });

    await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_GLOBAL);

    expect(
      (await store.listPresets("global", "settings:ci", jobUrl)).map((preset) => preset.name).sort()
    ).toEqual(["Release (2)", "release"]);
  });

  it("deletes the secrets it stored when the copy cannot be saved", async () => {
    const secrets = createFakeSecretStorage();
    const context = createExtensionContext({ secrets });
    const store = new JenkinsParameterPresetStore(context);
    await store.savePreset("global", "manual", `${URL}job/a/`, {
      name: "Release",
      values: {},
      secretValues: { TOKEN: "s3cret" }
    });
    const workspaceState = context.workspaceState as vscode.Memento;
    workspaceState.update = async () => {
      throw new Error("disk full");
    };

    await expect(store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE)).rejects.toThrow(
      "disk full"
    );
    expect(secrets.values.size).toBe(1);
  });
});

describe("JenkinsDiagnosticProfileBindingStore.copyEnvironmentRecords", () => {
  it("copies bindings across scopes and undoes them", async () => {
    const context = createExtensionContext();
    const store = new JenkinsDiagnosticProfileBindingStore(context);
    await store.setBinding("global", {
      environmentId: "manual",
      jobScopeUrl: `${URL}job/a/`,
      repositoryUri: "file:///repo",
      profileId: "maven",
      enabled: true
    });

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(
      store.getBinding("workspace", "settings:ci", `${URL}job/a/`, "file:///repo")
    ).toMatchObject({ profileId: "maven", scope: "workspace" });
    expect((await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE)).copied).toBe(0);

    await copy.undo();
    expect(store.listBindings().map((binding) => binding.environmentId)).toEqual(["manual"]);
  });
});

describe("JenkinsRepositoryLinkStore.copyEnvironmentRecords", () => {
  const link = (environmentId: string, scope: "workspace" | "global") => ({
    environment: { environmentId, scope },
    multibranchFolderUrl: `${URL}job/mb/`,
    multibranchLabel: "mb"
  });

  it("re-points a link in place within the same scope", async () => {
    const context = createExtensionContext();
    const store = new JenkinsRepositoryLinkStore(context);
    await store.setLink("file:///repo", link("manual", "global"));

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_GLOBAL);
    expect(copy.copied).toBe(1);
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "settings:ci",
      scope: "global"
    });

    await copy.undo();
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "manual",
      scope: "global"
    });
  });

  it("keeps the user-wide link for other workspaces when the target is workspace-scoped", async () => {
    const context = createExtensionContext();
    const store = new JenkinsRepositoryLinkStore(context);
    await store.setLink("file:///repo", link("manual", "global"));

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "settings:ci",
      scope: "workspace"
    });
    const globalLinks = context.globalState.get<{ links: Record<string, unknown> }>(
      "jenkinsWorkbench.repositoryLinks"
    );
    expect(globalLinks?.links["file:///repo"]).toMatchObject({ environmentId: "manual" });
    expect((await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE)).copied).toBe(0);

    await copy.undo();
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "manual",
      scope: "global"
    });
  });

  it("moves a workspace link into user settings scope like setLink", async () => {
    const context = createExtensionContext();
    const store = new JenkinsRepositoryLinkStore(context);
    await store.setLink("file:///repo", link("manual", "workspace"));

    const copy = await store.copyEnvironmentRecords(
      { scope: "workspace", environmentId: "manual" },
      DECLARED_GLOBAL
    );
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "settings:ci",
      scope: "global"
    });
    expect(
      context.workspaceState.get<{ links: Record<string, unknown> }>(
        "jenkinsWorkbench.repositoryLinks"
      )?.links
    ).toEqual({});

    await copy.undo();
    expect(store.getLink("file:///repo")?.environment).toEqual({
      environmentId: "manual",
      scope: "workspace"
    });
    expect(
      context.globalState.get<{ links: Record<string, unknown> }>(
        "jenkinsWorkbench.repositoryLinks"
      )?.links
    ).toEqual({});
  });

  it("keeps the workspace link when both mementos link the repository to the source", async () => {
    const context = createExtensionContext();
    const store = new JenkinsRepositoryLinkStore(context);
    const stored = (multibranchFolderUrl: string) => ({
      environmentId: "manual",
      scope: "global" as const,
      multibranchFolderUrl,
      multibranchLabel: "mb"
    });
    const workspaceLink = stored(`${URL}job/workspace-mb/`);
    const globalLink = stored(`${URL}job/global-mb/`);
    await context.workspaceState.update("jenkinsWorkbench.repositoryLinks", {
      links: { "file:///repo": workspaceLink }
    });
    await context.globalState.update("jenkinsWorkbench.repositoryLinks", {
      links: { "file:///repo": globalLink }
    });
    const readLinks = (memento: vscode.Memento) =>
      memento.get<{ links: Record<string, unknown> }>("jenkinsWorkbench.repositoryLinks")?.links;

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_GLOBAL);

    expect(copy.copied).toBe(1);
    expect(store.getLink("file:///repo")).toMatchObject({
      environment: { environmentId: "settings:ci", scope: "global" },
      multibranchFolderUrl: `${URL}job/workspace-mb/`
    });
    expect(readLinks(context.workspaceState)).toEqual({});

    await copy.undo();
    expect(readLinks(context.workspaceState)).toEqual({ "file:///repo": workspaceLink });
    expect(readLinks(context.globalState)).toEqual({ "file:///repo": globalLink });
  });
});

describe("HistoryBaselineStore.copyEnvironmentRecords", () => {
  it("copies baselines into the target scope without replacing existing ones", async () => {
    const context = createExtensionContext();
    const store = new HistoryBaselineStore(context);
    const manual = { environmentId: "manual", scope: "global" as const, url: URL };
    const target = { environmentId: "settings:ci", scope: "workspace" as const, url: URL };
    await store.set(manual, `${URL}job/a/`, `${URL}job/a/job/main/`);
    await store.set(manual, `${URL}job/b/`, `${URL}job/b/job/main/`);
    await store.set(target, `${URL}job/b/`, `${URL}job/b/job/develop/`);

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(store.get(target, `${URL}job/a/`)).toBe(`${URL}job/a/job/main/`);
    expect(store.get(target, `${URL}job/b/`)).toBe(`${URL}job/b/job/develop/`);

    await copy.undo();
    expect(store.get(target, `${URL}job/a/`)).toBeUndefined();
    expect(store.get(target, `${URL}job/b/`)).toBe(`${URL}job/b/job/develop/`);
    expect(store.get(manual, `${URL}job/a/`)).toBe(`${URL}job/a/job/main/`);
  });
});

describe("JenkinsCommitWatchStore.copyEnvironmentRecords", () => {
  function watch(id: string, environmentId: string): CommitWatch {
    return {
      id,
      repositoryUri: "file:///repo",
      repositoryLabel: "repo",
      repositories: ["file:///repo"],
      environment: { environmentId, scope: "global", url: URL },
      jobUrl: `${URL}job/a/`,
      label: "a",
      head: "a".repeat(40),
      createdAt: 1
    };
  }

  it("re-points watches and ignores a poll that read the old environment", async () => {
    const context = createExtensionContext();
    const store = new JenkinsCommitWatchStore(context.workspaceState);
    await store.add(watch("w1", "manual"));
    await store.add(watch("w2", "other"));
    const stale = store.list()[0];

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    await store.update({ ...stale, blockedReason: "stale poll" });
    const repointed = store.list().find((entry) => entry.id === "w1");
    expect(repointed?.environment).toMatchObject({
      environmentId: "settings:ci",
      scope: "workspace"
    });
    expect(repointed?.blockedReason).toBeUndefined();

    await copy.undo();
    expect(store.list().map((entry) => entry.environment.environmentId)).toEqual([
      "manual",
      "other"
    ]);
  });
});

describe("JenkinsViewStateStore.copyEnvironmentRecords", () => {
  it("copies branch filters to the new id and keeps existing ones", async () => {
    const context = createExtensionContext();
    const store = new JenkinsViewStateStore(context);
    await store.setBranchFilter("manual", `${URL}job/a/`, "feature");
    await store.setBranchFilter("manual", `${URL}job/b/`, "main");
    await store.setBranchFilter("settings:ci", `${URL}job/b/`, "release");

    const copy = await store.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(store.getBranchFilter("settings:ci", `${URL}job/a/`)).toBe("feature");
    expect(store.getBranchFilter("settings:ci", `${URL}job/b/`)).toBe("release");

    await copy.undo();
    expect(store.getBranchFilter("settings:ci", `${URL}job/a/`)).toBeUndefined();
    expect(store.getBranchFilter("manual", `${URL}job/a/`)).toBe("feature");
  });
});

describe("copyJenkinsfileEnvironmentSelections", () => {
  it("re-points folder selections and restores them on undo", async () => {
    const context = createExtensionContext();
    const key = "jenkinsWorkbench.jenkinsfileValidation.environmentSelections";
    await context.workspaceState.update(key, {
      selections: {
        "file:///a": { environmentId: "manual", scope: "global" },
        "file:///b": { environmentId: "other", scope: "global" }
      }
    });

    const copy = await copyJenkinsfileEnvironmentSelections(
      context.workspaceState,
      MANUAL_GLOBAL,
      DECLARED_WORKSPACE
    );
    expect(copy.copied).toBe(1);
    expect(context.workspaceState.get(key)).toEqual({
      selections: {
        "file:///a": { environmentId: "settings:ci", scope: "workspace" },
        "file:///b": { environmentId: "other", scope: "global" }
      }
    });

    await copy.undo();
    expect(context.workspaceState.get(key)).toEqual({
      selections: {
        "file:///a": { environmentId: "manual", scope: "global" },
        "file:///b": { environmentId: "other", scope: "global" }
      }
    });
  });
});

describe("EnvironmentUrlRebaseService.copyEnvironmentRecords", () => {
  it("copies the workspace rebase marker to the target", async () => {
    const context = createExtensionContext();
    const key = "jenkinsWorkbench.environmentUrlRebases";
    await context.workspaceState.update(key, { "global:manual": URL });
    const service = new EnvironmentUrlRebaseService({
      environmentStore: new JenkinsEnvironmentStore(context),
      pinStore: new JenkinsPinStore(context),
      watchStore: new JenkinsWatchStore(context),
      presetStore: new JenkinsParameterPresetStore(context),
      diagnosticBindingStore: new JenkinsDiagnosticProfileBindingStore(context),
      repositoryLinkStore: new JenkinsRepositoryLinkStore(context),
      historyBaselineStore: new HistoryBaselineStore(context),
      viewStateStore: new JenkinsViewStateStore(context),
      commitWatchStore: new JenkinsCommitWatchStore(context.workspaceState),
      workspaceState: context.workspaceState
    });

    const copy = await service.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE);
    expect(copy.copied).toBe(1);
    expect(context.workspaceState.get(key)).toEqual({
      "global:manual": URL,
      "workspace:settings:ci": URL
    });
    expect((await service.copyEnvironmentRecords(MANUAL_GLOBAL, DECLARED_WORKSPACE)).copied).toBe(
      0
    );

    await copy.undo();
    expect(context.workspaceState.get(key)).toEqual({ "global:manual": URL });
  });
});
