import { describe, expect, it, vi } from "vitest";
import { DeclaredEnvironmentCoordinator } from "../src/environments/sharing/DeclaredEnvironmentCoordinator";
import {
  createDeclaredEnvironmentView,
  DeclaredEnvironmentRegistry
} from "../src/environments/sharing/DeclaredEnvironmentRegistry";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../src/environments/sharing/DeclaredEnvironmentSource";
import { DeclaredEnvironmentStateStore } from "../src/environments/sharing/DeclaredEnvironmentStateStore";
import { EnvironmentUrlRebaseService } from "../src/services/EnvironmentUrlRebaseService";
import type { EnvironmentScope } from "../src/storage/JenkinsEnvironmentStore";
import { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import { EventEmitter } from "./helpers/vscodeStub";
import { createExtensionContext } from "./helpers/storageMocks";

function declared(url: string, scope: EnvironmentScope = "workspace"): DeclaredEnvironment {
  return {
    scope,
    slug: "ci",
    id: "settings:ci",
    url,
    origin: { level: scope === "global" ? "user" : "workspace" }
  };
}

function setup(initial: DeclaredEnvironment[]) {
  let declarations = initial;
  const changes = new EventEmitter<void>();
  const source = {
    getDeclared: (scope: EnvironmentScope) => declarations.filter((entry) => entry.scope === scope),
    getDeclaration: (scope: EnvironmentScope, id: string) =>
      declarations.find((entry) => entry.scope === scope && entry.id === id),
    onDidChange: changes.event
  } as unknown as DeclaredEnvironmentSource;
  const context = createExtensionContext();
  const state = new DeclaredEnvironmentStateStore(context);
  const environmentStore = new JenkinsEnvironmentStore(
    context,
    createDeclaredEnvironmentView({ source, state })
  );
  const rebaseAll = vi.fn(async (): Promise<void> => undefined);
  const invalidateClient = vi.fn();
  const registry = new DeclaredEnvironmentRegistry({
    source,
    state,
    environmentStore,
    clientProvider: { invalidateClient }
  });
  const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));
  const storeChanges: unknown[] = [];
  environmentStore.onDidChange((change) => storeChanges.push(change));
  const coordinator = new DeclaredEnvironmentCoordinator({
    source,
    registry,
    urlRebaseService: { rebaseAll },
    clientProvider: { invalidateClient },
    refreshHost: { fullEnvironmentRefresh }
  });
  return {
    context,
    state,
    registry,
    environmentStore,
    coordinator,
    rebaseAll,
    invalidateClient,
    fullEnvironmentRefresh,
    storeChanges,
    onDidChange: changes.event,
    change(next: DeclaredEnvironment[]) {
      declarations = next;
      changes.fire();
    }
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("DeclaredEnvironmentCoordinator", () => {
  it("records the URL at activation without rebasing, invalidating, or refreshing", async () => {
    const harness = setup([declared("https://ci.example/")]);
    await harness.coordinator.start();

    expect(harness.state.get("workspace", "settings:ci")).toEqual({
      lastUrl: "https://ci.example/"
    });
    expect(harness.rebaseAll).not.toHaveBeenCalled();
    expect(harness.invalidateClient).not.toHaveBeenCalled();
    expect(harness.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });

  it("rebases at activation when the declared URL changed while the window was closed", async () => {
    const harness = setup([declared("https://new.example/")]);
    await harness.state.update("workspace", "settings:ci", { lastUrl: "https://old.example/" });

    await harness.coordinator.start();

    expect(harness.state.get("workspace", "settings:ci").previousUrls).toEqual([
      "https://old.example/"
    ]);
    expect(harness.rebaseAll).toHaveBeenCalledTimes(1);
    expect(harness.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });

  it("on a settings URL change records previousUrls, rebases, invalidates, and refreshes", async () => {
    const harness = setup([declared("https://ci.example/")]);
    await harness.coordinator.start();

    harness.change([declared("https://ci2.example/")]);
    await settle();

    expect(harness.state.get("workspace", "settings:ci")).toEqual({
      lastUrl: "https://ci2.example/",
      previousUrls: ["https://ci.example/"]
    });
    expect(harness.rebaseAll).toHaveBeenCalledTimes(1);
    expect(harness.invalidateClient).toHaveBeenCalledWith("workspace", "settings:ci");
    // Open panels and pollers see the URL change like a stored edit, then the bulk refresh.
    expect(harness.storeChanges).toEqual([
      {
        kind: "environment-updated",
        scope: "workspace",
        environmentId: "settings:ci",
        urlChanged: true,
        environment: {
          id: "settings:ci",
          url: "https://ci2.example/",
          previousUrls: ["https://ci.example/"],
          source: "settings"
        }
      },
      { kind: "bulk-update" }
    ]);
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledWith({ trigger: "system" });
    expect(harness.rebaseAll.mock.invocationCallOrder[0]).toBeLessThan(
      harness.fullEnvironmentRefresh.mock.invocationCallOrder[0]
    );
    // The merged record now carries the previous URL that drives the rebase.
    expect((await harness.environmentStore.getEnvironments("workspace"))[0]).toMatchObject({
      id: "settings:ci",
      url: "https://ci2.example/",
      previousUrls: ["https://ci.example/"]
    });
  });

  it("refreshes without rebasing when declarations change but URLs do not", async () => {
    const harness = setup([declared("https://ci.example/")]);
    await harness.coordinator.start();

    harness.change([{ ...declared("https://ci.example/"), name: "CI" }]);
    await settle();
    expect(harness.rebaseAll).not.toHaveBeenCalled();
    expect(harness.invalidateClient).toHaveBeenCalledWith("workspace", "settings:ci");
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledTimes(1);

    harness.change([]);
    await settle();
    expect(harness.invalidateClient).toHaveBeenCalledTimes(2);
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledTimes(2);
  });

  it("stops following settings once disposed", async () => {
    const harness = setup([declared("https://ci.example/")]);
    await harness.coordinator.start();
    harness.coordinator.dispose();

    harness.change([declared("https://ci2.example/")]);
    await settle();
    expect(harness.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });

  it("rebases pinned jobs of a declared environment through the real rebase service", async () => {
    const harness = setup([declared("https://ci.example/")]);
    const pinStore = new JenkinsPinStore(harness.context);
    await pinStore.addPin("workspace", {
      environmentId: "settings:ci",
      jobUrl: "https://ci.example/job/app/",
      jobName: "app",
      jobKind: "pipeline"
    });
    const noop = async () => undefined;
    const rebaseService = new EnvironmentUrlRebaseService({
      environmentStore: harness.environmentStore,
      pinStore,
      watchStore: { rebaseWatchUrls: noop },
      presetStore: { rebasePresetUrls: noop },
      diagnosticBindingStore: { rebaseBindingUrls: noop },
      repositoryLinkStore: { rebaseLinkUrls: noop },
      historyBaselineStore: { rebaseBaselineUrls: noop },
      viewStateStore: { rebaseBranchFilterUrls: noop },
      commitWatchStore: { rebaseCommitWatchUrls: noop },
      workspaceState: harness.context.workspaceState
    } as unknown as ConstructorParameters<typeof EnvironmentUrlRebaseService>[0]);
    harness.rebaseAll.mockImplementation(() => rebaseService.rebaseAll());
    await harness.coordinator.start();

    harness.change([declared("https://ci2.example/")]);
    await settle();
    await vi.waitFor(() => expect(harness.fullEnvironmentRefresh).toHaveBeenCalled());

    const pins = await pinStore.listPinnedJobsForEnvironment("workspace", "settings:ci");
    expect(pins.map((pin) => pin.jobUrl)).toEqual(["https://ci2.example/job/app/"]);
  });

  it("offers adoption after the activation reconcile and after each settings change", async () => {
    const harness = setup([declared("https://ci.example/")]);
    const promptForCandidates = vi.fn(async () => undefined);
    const coordinator = new DeclaredEnvironmentCoordinator({
      source: { getDeclared: () => [], onDidChange: harness.onDidChange },
      registry: harness.registry,
      urlRebaseService: { rebaseAll: harness.rebaseAll },
      clientProvider: { invalidateClient: harness.invalidateClient },
      refreshHost: { fullEnvironmentRefresh: harness.fullEnvironmentRefresh },
      adoptionService: { promptForCandidates }
    });

    await coordinator.start();
    await settle();
    expect(promptForCandidates).toHaveBeenCalledTimes(1);

    harness.change([]);
    await vi.waitFor(() => expect(promptForCandidates).toHaveBeenCalledTimes(2));
    coordinator.dispose();
  });

  it("does not fail activation when offering adoption fails", async () => {
    const harness = setup([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const coordinator = new DeclaredEnvironmentCoordinator({
      source: { getDeclared: () => [], onDidChange: () => ({ dispose: () => undefined }) },
      registry: harness.registry,
      urlRebaseService: { rebaseAll: harness.rebaseAll },
      clientProvider: { invalidateClient: harness.invalidateClient },
      refreshHost: { fullEnvironmentRefresh: harness.fullEnvironmentRefresh },
      adoptionService: {
        get promptForCandidates(): () => Promise<void> {
          throw new Error("not constructible");
        }
      }
    });

    await expect(coordinator.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
