import type * as vscode from "vscode";
import { ReplayBuildWorkflow } from "../../commands/build/ReplayBuildWorkflow";
import { JobConfigUpdateWorkflow } from "../../commands/job/JobConfigUpdateWorkflow";
import { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { createFileArtifactFilesystem } from "../../services/ArtifactFilesystem";
import { ArtifactStorageService } from "../../services/ArtifactStorageService";
import { BrowserSsoAuthenticationService } from "../../services/BrowserSsoAuthenticationService";
import {
  BuildConsoleExporter,
  createNodeBuildConsoleFilesystem
} from "../../services/BuildConsoleExporter";
import { BuildParameterRequestPreparerService } from "../../services/BuildParameterRequestPreparerService";
import { MAX_CONSOLE_CHARS } from "../../services/ConsoleOutputConfig";
import { JobConfigDraftFilesystem } from "../../services/JobConfigDraftFilesystem";
import { JobConfigDraftManager } from "../../services/JobConfigDraftManager";
import { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import { ReplayDraftFilesystem } from "../../services/ReplayDraftFilesystem";
import { ReplayDraftManager } from "../../services/ReplayDraftManager";
import { WorkspaceTestSourceFileMatchConfig } from "../../services/TestSourceFileMatchConfig";
import { DefaultTestSourceFileMatchStrategy } from "../../services/TestSourceFileMatchStrategy";
import { TestSourceNavigationUiService } from "../../services/TestSourceNavigationUiService";
import { TestSourceResolver } from "../../services/TestSourceResolver";
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
import { JobConfigPreviewer } from "../../ui/JobConfigPreviewer";
import { WorkspacePreviewer } from "../../ui/WorkspacePreviewer";
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
    consoleExporter: (container) =>
      new BuildConsoleExporter(container.get("dataService"), createNodeBuildConsoleFilesystem(), {
        maxConsoleChars: MAX_CONSOLE_CHARS
      }),
    artifactStorageService: (container) => {
      const dataService = container.get("dataService");
      return new ArtifactStorageService(
        {
          getArtifactStream: (...args) => dataService.getArtifactStream(...args)
        },
        createFileArtifactFilesystem()
      );
    },
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
    replayBuildWorkflow: (container) =>
      new ReplayBuildWorkflow(
        container.get("dataService"),
        container.get("replayDraftManager"),
        container.get("queuedBuildWaiter")
      ),
    artifactActionHandler: (container) => {
      const dataService = container.get("dataService");
      const artifactPreviewer = new ArtifactPreviewer(
        {
          getArtifact: (...args) => dataService.getArtifact(...args)
        },
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
