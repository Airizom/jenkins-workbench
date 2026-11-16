import type * as vscode from "vscode";
import { LocalJenkinsfileReplayWorkflow } from "../../commands/build/LocalJenkinsfileReplayWorkflow";
import { LocalJenkinsfileResolver } from "../../commands/build/LocalJenkinsfileResolver";
import { resolveLocalReplayJobSuggestion } from "../../commands/build/LocalReplayJobSuggestion";
import { ReplayBuildWorkflow } from "../../commands/build/ReplayBuildWorkflow";
import { JobConfigUpdateWorkflow } from "../../commands/job/JobConfigUpdateWorkflow";
import { EnvironmentDiagnosticsService } from "../../environmentDiagnostics/EnvironmentDiagnosticsService";
import { DeclaredEnvironmentCoordinator } from "../../environments/sharing/DeclaredEnvironmentCoordinator";
import {
  createDeclaredEnvironmentView,
  DeclaredEnvironmentRegistry
} from "../../environments/sharing/DeclaredEnvironmentRegistry";
import { DeclaredEnvironmentSource } from "../../environments/sharing/DeclaredEnvironmentSource";
import {
  type DeclaredEnvironmentStateReader,
  DeclaredEnvironmentStateStore
} from "../../environments/sharing/DeclaredEnvironmentStateStore";
import { EnvironmentSyncService } from "../../environments/sync/EnvironmentSyncService";
import { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { createFileArtifactFilesystem } from "../../services/ArtifactFilesystem";
import { ArtifactStorageService } from "../../services/ArtifactStorageService";
import { BrowserSsoAuthenticationService } from "../../services/BrowserSsoAuthenticationService";
import {
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../../services/BuildConsoleExporter";
import { BuildDescriptionDraftFilesystem } from "../../services/BuildDescriptionDraftFilesystem";
import { BuildDescriptionDraftManager } from "../../services/BuildDescriptionDraftManager";
import { BuildParameterRequestPreparerService } from "../../services/BuildParameterRequestPreparerService";
import { BuildLogTailer } from "../../services/buildFollow/BuildLogTailer";
import { TriggeredBuildLocator } from "../../services/buildFollow/TriggeredBuildLocator";
import { MAX_CONSOLE_CHARS } from "../../services/ConsoleOutputConfig";
import { EnvironmentAdoptionService } from "../../services/EnvironmentAdoptionService";
import { EnvironmentUrlRebaseService } from "../../services/EnvironmentUrlRebaseService";
import { JobConfigDraftFilesystem } from "../../services/JobConfigDraftFilesystem";
import { JobConfigDraftManager } from "../../services/JobConfigDraftManager";
import { MultibranchScanStateStore } from "../../services/multibranchScan/MultibranchScanState";
import { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import { ReplayDraftFilesystem } from "../../services/ReplayDraftFilesystem";
import { ReplayDraftManager } from "../../services/ReplayDraftManager";
import { WorkspaceTestSourceFileMatchConfig } from "../../services/TestSourceFileMatchConfig";
import { DefaultTestSourceFileMatchStrategy } from "../../services/TestSourceFileMatchStrategy";
import { TestSourceNavigationUiService } from "../../services/TestSourceNavigationUiService";
import { TestSourceResolver } from "../../services/TestSourceResolver";
import { createLazyOutputChannel } from "../../shared/LazyOutputChannel";
import { createEnvironmentRecordParticipants } from "../../storage/EnvironmentRecordParticipant";
import { JenkinsCommitWatchStore } from "../../storage/JenkinsCommitWatchStore";
import { JenkinsDiagnosticProfileBindingStore } from "../../storage/JenkinsDiagnosticProfileBindingStore";
import { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import { JenkinsRepositoryLinkStore } from "../../storage/JenkinsRepositoryLinkStore";
import { JenkinsViewStateStore } from "../../storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import {
  type ArtifactActionOptionsProvider,
  DefaultArtifactActionHandler
} from "../../ui/ArtifactActionHandler";
import { ArtifactPreviewer, type ArtifactPreviewOptionsProvider } from "../../ui/ArtifactPreviewer";
import {
  ArtifactPreviewProvider,
  type ArtifactPreviewProviderOptions
} from "../../ui/ArtifactPreviewProvider";
import { BuildLogPreviewer } from "../../ui/BuildLogPreviewer";
import { pickJenkinsJob } from "../../ui/JenkinsJobPicker";
import { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import { WorkspacePreviewer } from "../../ui/WorkspacePreviewer";
import {
  copyJenkinsfileEnvironmentSelections,
  removeJenkinsfileEnvironmentSelections
} from "../../validation/JenkinsfileEnvironmentResolver";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";
import { syncNoEnvironmentsContext } from "../contextKeys";

export interface CoreProviderOptions {
  context: vscode.ExtensionContext;
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
}

export function createCoreProviderCatalog(options: CoreProviderOptions) {
  // Only the registry gets the writable store; the `declaredEnvironmentState` token exposes it
  // read-only, so the registry stays the only writer of declared local state.
  let declaredState: DeclaredEnvironmentStateStore | undefined;
  const getDeclaredState = () => {
    declaredState ??= new DeclaredEnvironmentStateStore(options.context);
    return declaredState;
  };
  return {
    environmentDiagnosticsService: (container) =>
      new EnvironmentDiagnosticsService(
        container.get("dataService"),
        container.get("environmentStore")
      ),
    multibranchScanState: (_container) => {
      const state = new MultibranchScanStateStore();
      options.context.subscriptions.push(state);
      return state;
    },
    environmentStore: (container) =>
      new JenkinsEnvironmentStore(
        options.context,
        createDeclaredEnvironmentView({
          source: container.get("declaredEnvironmentSource"),
          state: container.get("declaredEnvironmentState")
        })
      ),
    declaredEnvironmentRegistry: (container) =>
      new DeclaredEnvironmentRegistry({
        source: container.get("declaredEnvironmentSource"),
        state: getDeclaredState(),
        environmentStore: container.get("environmentStore"),
        // Dropping cached clients never needs the provider built first.
        clientProvider: container.lazy("clientProvider")
      }),
    declaredEnvironmentSource: (_container) => {
      const log = createLazyOutputChannel("Jenkins Environments");
      const source = new DeclaredEnvironmentSource({ log });
      options.context.subscriptions.push(source, log);
      return source;
    },
    declaredEnvironmentState: (_container): DeclaredEnvironmentStateReader => getDeclaredState(),
    declaredEnvironmentCoordinator: (container) => {
      const coordinator = new DeclaredEnvironmentCoordinator({
        source: container.get("declaredEnvironmentSource"),
        registry: container.get("declaredEnvironmentRegistry"),
        urlRebaseService: container.get("environmentUrlRebaseService"),
        // Resolved on the first settings change, not at activation.
        clientProvider: container.lazy("clientProvider"),
        refreshHost: container.lazy("refreshHost"),
        adoptionService: container.lazy("environmentAdoptionService")
      });
      options.context.subscriptions.push(coordinator);
      return coordinator;
    },
    environmentAdoptionService: (container) =>
      new EnvironmentAdoptionService({
        source: container.get("declaredEnvironmentSource"),
        state: container.get("declaredEnvironmentState"),
        registry: container.get("declaredEnvironmentRegistry"),
        environmentStore: container.get("environmentStore"),
        participants: container.get("environmentRecordParticipants"),
        urlRebaseService: container.get("environmentUrlRebaseService"),
        clientProvider: container.lazy("clientProvider"),
        refreshHost: container.lazy("refreshHost")
      }),
    // The one list of per-environment record stores, used to link, remove and hide environments.
    // Every store is referenced lazily: none is built until records are copied or removed.
    environmentRecordParticipants: (container) =>
      createEnvironmentRecordParticipants({
        pinStore: container.lazy("pinStore"),
        watchStore: container.lazy("watchStore"),
        watchRuntimeState: {
          copyEnvironmentRecords: (from, to) =>
            container.lazy("poller").copyWatchRuntimeState(from, to),
          removeEnvironmentRecords: async (ref) =>
            container.lazy("poller").removeWatchRuntimeState(ref)
        },
        presetStore: container.lazy("presetStore"),
        diagnosticBindingStore: container.lazy("diagnosticBindingStore"),
        repositoryLinkStore: container.lazy("repositoryLinkStore"),
        historyBaselineStore: container.lazy("historyBaselineStore"),
        commitWatchStore: container.lazy("commitWatchStore"),
        viewStateStore: container.lazy("viewStateStore"),
        jenkinsfileSelections: {
          copyEnvironmentRecords: (from, to) =>
            copyJenkinsfileEnvironmentSelections(options.context.workspaceState, from, to),
          removeEnvironmentRecords: (ref) =>
            removeJenkinsfileEnvironmentSelections(options.context.workspaceState, ref)
        },
        urlRebaseService: container.lazy("environmentUrlRebaseService")
      }),
    environmentSyncService: (container) => {
      const service = new EnvironmentSyncService({
        globalState: options.context.globalState,
        environmentStore: container.get("environmentStore"),
        clientProvider: container.lazy("clientProvider"),
        refreshHost: container.lazy("refreshHost"),
        syncNoEnvironmentsContext: () =>
          syncNoEnvironmentsContext(container.get("environmentStore"))
      });
      options.context.subscriptions.push(service);
      return service;
    },
    environmentUrlRebaseService: (container) =>
      new EnvironmentUrlRebaseService({
        environmentStore: container.get("environmentStore"),
        pinStore: container.get("pinStore"),
        watchStore: container.get("watchStore"),
        presetStore: container.get("presetStore"),
        diagnosticBindingStore: container.get("diagnosticBindingStore"),
        repositoryLinkStore: container.get("repositoryLinkStore"),
        historyBaselineStore: container.get("historyBaselineStore"),
        viewStateStore: container.get("viewStateStore"),
        commitWatchStore: container.get("commitWatchStore"),
        workspaceState: options.context.workspaceState
      }),
    commitWatchStore: (_container) => new JenkinsCommitWatchStore(options.context.workspaceState),
    diagnosticBindingStore: (_container) =>
      new JenkinsDiagnosticProfileBindingStore(options.context),
    browserSsoAuthenticator: (_container) => new BrowserSsoAuthenticationService(),
    clientProvider: (container) =>
      new JenkinsClientProvider(container.get("environmentStore"), {
        browserSsoAuthenticator: container.get("browserSsoAuthenticator"),
        requestTimeoutMs: options.requestTimeoutMs
      }),
    dataService: (container) => {
      const buildParameterRequestPreparer = new BuildParameterRequestPreparerService();
      return new JenkinsDataService(container.get("clientProvider"), {
        cacheTtlMs: options.cacheTtlMs,
        maxCacheEntries: options.maxCacheEntries,
        buildParameterRequestPreparer
      });
    },
    pendingInputCoordinator: (container) =>
      new PendingInputRefreshCoordinator(container.get("dataService")),
    queuedBuildWaiter: (container) => new QueuedBuildWaiter(container.get("dataService")),
    triggeredBuildLocator: (container) =>
      new TriggeredBuildLocator(container.get("dataService"), container.get("queuedBuildWaiter")),
    buildLogTailer: (container) => {
      const tailer = new BuildLogTailer(
        container.get("dataService"),
        container.get("artifactPreviewProvider"),
        MAX_CONSOLE_CHARS
      );
      options.context.subscriptions.push(tailer);
      return tailer;
    },
    consoleExporter: (container) =>
      new BuildConsoleExporter(container.get("dataService"), createNodeBuildConsoleFilesystem(), {
        maxConsoleChars: MAX_CONSOLE_CHARS
      }),
    artifactStorageService: (container) =>
      new ArtifactStorageService(container.get("dataService"), createFileArtifactFilesystem()),
    artifactPreviewProvider: (_container) =>
      new ArtifactPreviewProvider(options.artifactPreviewCacheOptions),
    buildLogPreviewer: (container) =>
      new BuildLogPreviewer(
        container.get("dataService"),
        container.get("artifactPreviewProvider"),
        MAX_CONSOLE_CHARS
      ),
    jobConfigPreviewer: (container) =>
      new JobConfigPreviewer(container.get("artifactPreviewProvider")),
    workspacePreviewer: (container) =>
      new WorkspacePreviewer(
        container.get("dataService"),
        container.get("artifactPreviewProvider"),
        options.artifactPreviewOptionsProvider
      ),
    jobConfigDraftFilesystem: (_container) => new JobConfigDraftFilesystem(),
    jobConfigDraftManager: (container) =>
      new JobConfigDraftManager(container.get("jobConfigDraftFilesystem")),
    jobConfigUpdateWorkflow: (container) =>
      new JobConfigUpdateWorkflow(
        container.get("dataService"),
        container.get("jobConfigPreviewer"),
        container.get("jobConfigDraftManager")
      ),
    buildDescriptionDraftFilesystem: (_container) => new BuildDescriptionDraftFilesystem(),
    buildDescriptionDraftManager: (container) =>
      new BuildDescriptionDraftManager(container.get("buildDescriptionDraftFilesystem")),
    replayDraftFilesystem: (_container) => new ReplayDraftFilesystem(),
    replayDraftManager: (container) =>
      new ReplayDraftManager(container.get("replayDraftFilesystem")),
    testSourceFileMatchConfig: (_container) => new WorkspaceTestSourceFileMatchConfig(),
    testSourceFileMatchStrategy: (container) =>
      new DefaultTestSourceFileMatchStrategy(container.get("testSourceFileMatchConfig")),
    testSourceResolver: (container) =>
      new TestSourceResolver(
        container.get("repositoryLinkStore"),
        container.get("testSourceFileMatchStrategy")
      ),
    testSourceNavigationUiService: (container) =>
      new TestSourceNavigationUiService(container.get("testSourceResolver")),
    localJenkinsfileReplayWorkflow: (container) =>
      new LocalJenkinsfileReplayWorkflow(
        container.get("dataService"),
        new LocalJenkinsfileResolver(container.get("jenkinsfileMatcher")),
        {
          pick: async (sourceUri) => {
            const selection = await pickJenkinsJob(
              container.get("dataService"),
              container.get("environmentStore"),
              {
                filter: (entry) => entry.kind === "pipeline",
                suggestion: resolveLocalReplayJobSuggestion(
                  sourceUri,
                  container.get("currentBranchWorkflowService")
                ),
                title: "Replay with Local Jenkinsfile",
                placeholder: "Choose a Pipeline job to replay using its latest completed build",
                noResultsMessage: "No Pipeline jobs found with current search settings."
              }
            );
            return selection
              ? {
                  environment: selection.environment,
                  jobUrl: selection.entry.url,
                  label: selection.entry.fullName
                }
              : undefined;
          }
        },
        container.lazy("buildFollowUpService")
      ),
    replayBuildWorkflow: (container) =>
      new ReplayBuildWorkflow(
        container.get("dataService"),
        container.get("replayDraftManager"),
        container.lazy("buildFollowUpService")
      ),
    artifactActionHandler: (container) => {
      const artifactPreviewer = new ArtifactPreviewer(
        container.get("dataService"),
        container.get("artifactPreviewProvider"),
        options.artifactPreviewOptionsProvider
      );

      return new DefaultArtifactActionHandler(
        container.get("artifactStorageService"),
        artifactPreviewer,
        options.artifactActionOptionsProvider
      );
    },
    watchStore: (_container) => new JenkinsWatchStore(options.context),
    presetStore: (_container) => new JenkinsParameterPresetStore(options.context),
    pinStore: (_container) => new JenkinsPinStore(options.context),
    repositoryLinkStore: (_container) => new JenkinsRepositoryLinkStore(options.context),
    viewStateStore: (_container) => new JenkinsViewStateStore(options.context)
  } satisfies PartialExtensionProviderCatalog;
}
