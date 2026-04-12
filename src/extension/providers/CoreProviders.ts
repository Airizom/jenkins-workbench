import type * as vscode from "vscode";
import { ReplayBuildWorkflow } from "../../commands/build/ReplayBuildWorkflow";
import { JobConfigUpdateWorkflow } from "../../commands/job/JobConfigUpdateWorkflow";
import { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { ArtifactActionService } from "../../services/ArtifactActionService";
import { createFileArtifactFilesystem } from "../../services/ArtifactFilesystem";
import { DefaultArtifactRetrievalService } from "../../services/ArtifactRetrievalService";
import { ArtifactStorageService } from "../../services/ArtifactStorageService";
import {
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../../services/BuildConsoleExporter";
import { BuildLogService } from "../../services/BuildLogService";
import { BuildParameterRequestPreparerService } from "../../services/BuildParameterRequestPreparerService";
import { MAX_CONSOLE_CHARS } from "../../services/ConsoleOutputConfig";
import { JobConfigDraftFilesystem } from "../../services/JobConfigDraftFilesystem";
import { JobConfigDraftManager } from "../../services/JobConfigDraftManager";
import { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import { ReplayDraftFilesystem } from "../../services/ReplayDraftFilesystem";
import { ReplayDraftManager } from "../../services/ReplayDraftManager";
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
import {
  ArtifactPreviewProvider,
  type ArtifactPreviewProviderOptions
} from "../../ui/ArtifactPreviewProvider";
import { type ArtifactPreviewOptionsProvider, ArtifactPreviewer } from "../../ui/ArtifactPreviewer";
import { BuildLogPreviewer } from "../../ui/BuildLogPreviewer";
import { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

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
  return {
    environmentStore: (_container) => new JenkinsEnvironmentStore(options.context),
    clientProvider: (container) =>
      new JenkinsClientProvider(container.get("environmentStore"), {
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
    consoleExporter: (container) =>
      new BuildConsoleExporter(container.get("dataService"), createNodeBuildConsoleFilesystem(), {
        maxConsoleChars: MAX_CONSOLE_CHARS
      }),
    buildLogService: (container) => new BuildLogService(container.get("dataService")),
    artifactRetrievalService: (container) =>
      new DefaultArtifactRetrievalService(container.get("dataService")),
    artifactStorageService: (container) =>
      new ArtifactStorageService(
        container.get("artifactRetrievalService"),
        createFileArtifactFilesystem()
      ),
    artifactPreviewProvider: (_container) =>
      new ArtifactPreviewProvider(options.artifactPreviewCacheOptions),
    buildLogPreviewer: (container) =>
      new BuildLogPreviewer(
        container.get("buildLogService"),
        container.get("artifactPreviewProvider"),
        MAX_CONSOLE_CHARS
      ),
    jobConfigPreviewer: (container) =>
      new JobConfigPreviewer(container.get("artifactPreviewProvider")),
    jobConfigDraftFilesystem: (_container) => new JobConfigDraftFilesystem(),
    jobConfigDraftManager: (container) =>
      new JobConfigDraftManager(container.get("jobConfigDraftFilesystem")),
    jobConfigUpdateWorkflow: (container) =>
      new JobConfigUpdateWorkflow(
        container.get("dataService"),
        container.get("jobConfigPreviewer"),
        container.get("jobConfigDraftManager")
      ),
    replayDraftFilesystem: (_container) => new ReplayDraftFilesystem(),
    replayDraftManager: (container) =>
      new ReplayDraftManager(container.get("replayDraftFilesystem")),
    replayBuildWorkflow: (container) =>
      new ReplayBuildWorkflow(
        container.get("dataService"),
        container.get("replayDraftManager"),
        container.get("queuedBuildWaiter")
      ),
    artifactActionHandler: (container) => {
      const artifactActionService = new ArtifactActionService(
        container.get("artifactStorageService")
      );
      const artifactPreviewer = new ArtifactPreviewer(
        container.get("artifactRetrievalService"),
        container.get("artifactPreviewProvider"),
        options.artifactPreviewOptionsProvider
      );

      return new DefaultArtifactActionHandler(
        artifactActionService,
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
