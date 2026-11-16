import { vi } from "vitest";
import type * as vscode from "vscode";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../../src/environments/sharing/DeclaredEnvironmentSource";
import type { EnvironmentScope } from "../../src/storage/JenkinsEnvironmentStore";

export function declaredEnvironment(
  url: string,
  scope: EnvironmentScope = "workspace",
  slug = "ci"
): DeclaredEnvironment {
  return {
    scope,
    slug,
    id: `settings:${slug}`,
    url,
    origin: { level: scope === "global" ? "user" : "workspace" }
  };
}

/**
 * Real stores over in-memory mementos, a fake declaration source and fake client/refresh hosts.
 * Imports lazily so the calling test's `vi.doMock("vscode", ...)` applies to every module.
 */
export async function createAdoptionHarness(
  context: vscode.ExtensionContext,
  initial: DeclaredEnvironment[]
) {
  // Sequential on purpose: concurrent dynamic imports can race `vi.doMock("vscode")`, so a module
  // may load the default stub (no `window`) and fail intermittently under load.
  const { createDeclaredEnvironmentView, DeclaredEnvironmentRegistry } = await import(
    "../../src/environments/sharing/DeclaredEnvironmentRegistry"
  );
  const { DeclaredEnvironmentStateStore } = await import(
    "../../src/environments/sharing/DeclaredEnvironmentStateStore"
  );
  const { HistoryBaselineStore } = await import("../../src/history/HistoryBaseline");
  const { EnvironmentAdoptionService } = await import(
    "../../src/services/EnvironmentAdoptionService"
  );
  const { EnvironmentUrlRebaseService } = await import(
    "../../src/services/EnvironmentUrlRebaseService"
  );
  const { createEnvironmentRecordParticipants } = await import(
    "../../src/storage/EnvironmentRecordParticipant"
  );
  const { JenkinsCommitWatchStore } = await import("../../src/storage/JenkinsCommitWatchStore");
  const { JenkinsDiagnosticProfileBindingStore } = await import(
    "../../src/storage/JenkinsDiagnosticProfileBindingStore"
  );
  const { JenkinsEnvironmentStore } = await import("../../src/storage/JenkinsEnvironmentStore");
  const { JenkinsParameterPresetStore } = await import(
    "../../src/storage/JenkinsParameterPresetStore"
  );
  const { JenkinsPinStore } = await import("../../src/storage/JenkinsPinStore");
  const { JenkinsRepositoryLinkStore } = await import(
    "../../src/storage/JenkinsRepositoryLinkStore"
  );
  const { JenkinsViewStateStore } = await import("../../src/storage/JenkinsViewStateStore");
  const { JenkinsWatchStore } = await import("../../src/storage/JenkinsWatchStore");
  const { copyJenkinsfileEnvironmentSelections, removeJenkinsfileEnvironmentSelections } =
    await import("../../src/validation/JenkinsfileEnvironmentResolver");
  const { WatchRuntimeStateStore } = await import("../../src/watch/WatchRuntimeStateStore");

  let declarations = initial;
  const source = {
    getDeclared: (scope: EnvironmentScope) => declarations.filter((entry) => entry.scope === scope),
    getDeclaration: (scope: EnvironmentScope, id: string) =>
      declarations.find((entry) => entry.scope === scope && entry.id === id),
    getProblems: () => [],
    onDidChange: () => ({ dispose: () => undefined }),
    dispose: () => undefined
  } as unknown as DeclaredEnvironmentSource;
  const state = new DeclaredEnvironmentStateStore(context);
  const environmentStore = new JenkinsEnvironmentStore(
    context,
    createDeclaredEnvironmentView({ source, state })
  );
  const stores = {
    pinStore: new JenkinsPinStore(context),
    watchStore: new JenkinsWatchStore(context),
    presetStore: new JenkinsParameterPresetStore(context),
    diagnosticBindingStore: new JenkinsDiagnosticProfileBindingStore(context),
    repositoryLinkStore: new JenkinsRepositoryLinkStore(context),
    historyBaselineStore: new HistoryBaselineStore(context),
    viewStateStore: new JenkinsViewStateStore(context),
    commitWatchStore: new JenkinsCommitWatchStore(context.workspaceState)
  };
  const urlRebaseService = new EnvironmentUrlRebaseService({
    environmentStore,
    ...stores,
    workspaceState: context.workspaceState
  });
  const watchRuntimeState = new WatchRuntimeStateStore();
  const clientProvider = { invalidateClient: vi.fn() };
  const registry = new DeclaredEnvironmentRegistry({
    source,
    state,
    environmentStore,
    clientProvider
  });
  const participants = createEnvironmentRecordParticipants({
    ...stores,
    watchRuntimeState,
    jenkinsfileSelections: {
      copyEnvironmentRecords: (from, to) =>
        copyJenkinsfileEnvironmentSelections(context.workspaceState, from, to),
      removeEnvironmentRecords: (ref) =>
        removeJenkinsfileEnvironmentSelections(context.workspaceState, ref)
    },
    urlRebaseService
  });
  const refreshHost = {
    fullEnvironmentRefresh: vi.fn(() => ({ executed: true })),
    onEnvironmentRemoved: vi.fn()
  };
  const service = new EnvironmentAdoptionService({
    source,
    state,
    registry,
    environmentStore,
    participants,
    urlRebaseService,
    clientProvider,
    refreshHost
  });
  return {
    context,
    service,
    state,
    registry,
    participants,
    environmentStore,
    ...stores,
    urlRebaseService,
    watchRuntimeState,
    clientProvider,
    refreshHost,
    setDeclarations(next: DeclaredEnvironment[]) {
      declarations = next;
    }
  };
}
