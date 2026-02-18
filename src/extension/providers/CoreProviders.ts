import type * as vscode from "vscode";
import { JobConfigUpdateWorkflow } from "../../commands/job/JobConfigUpdateWorkflow";
import { JenkinsClientProvider } from "../../jenkins/JenkinsClientProvider";
import { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import { ArtifactActionService } from "../../services/ArtifactActionService";
import { createFileArtifactFilesystem } from "../../services/ArtifactFilesystem";
import {
  type ArtifactRetrievalService,
  DefaultArtifactRetrievalService
} from "../../services/ArtifactRetrievalService";
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
import { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import { JenkinsParameterPresetStore } from "../../storage/JenkinsParameterPresetStore";
import { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import { JenkinsViewStateStore } from "../../storage/JenkinsViewStateStore";
import { JenkinsWatchStore } from "../../storage/JenkinsWatchStore";
import {
  type ArtifactActionHandler,
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
import type { ExtensionContainer } from "../container/ExtensionContainer";

export interface CoreProviderOptions {
  context: vscode.ExtensionContext;
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
}

export function registerCoreProviders(
  container: ExtensionContainer,
  options: CoreProviderOptions
): void {
  container.register("environmentStore", () => new JenkinsEnvironmentStore(options.context));

  container.register(
    "clientProvider",
    () =>
      new JenkinsClientProvider(container.get("environmentStore"), {
        requestTimeoutMs: options.requestTimeoutMs
      })
  );

  container.register("dataService", () => {
    const buildParameterRequestPreparer = new BuildParameterRequestPreparerService();
    return new JenkinsDataService(container.get("clientProvider"), {
      cacheTtlMs: options.cacheTtlMs,
      maxCacheEntries: options.maxCacheEntries,
      buildParameterRequestPreparer
    });
  });

  container.register(
    "pendingInputCoordinator",
    () => new PendingInputRefreshCoordinator(container.get("dataService"))
  );

  container.register(
    "queuedBuildWaiter",
    () => new QueuedBuildWaiter(container.get("dataService"))
  );

  container.register(
    "consoleExporter",
    () =>
      new BuildConsoleExporter(container.get("dataService"), createNodeBuildConsoleFilesystem(), {
        maxConsoleChars: MAX_CONSOLE_CHARS
      })
  );

  container.register("buildLogService", () => new BuildLogService(container.get("dataService")));

  container.register(
    "artifactRetrievalService",
    () => new DefaultArtifactRetrievalService(container.get("dataService"))
  );

  container.register(
    "artifactStorageService",
    () =>
      new ArtifactStorageService(
        container.get("artifactRetrievalService") as ArtifactRetrievalService,
        createFileArtifactFilesystem()
      )
  );

  container.register(
    "artifactPreviewProvider",
    () => new ArtifactPreviewProvider(options.artifactPreviewCacheOptions)
  );

  container.register(
    "buildLogPreviewer",
    () =>
      new BuildLogPreviewer(
        container.get("buildLogService"),
        container.get("artifactPreviewProvider"),
        MAX_CONSOLE_CHARS
      )
  );

  container.register(
    "jobConfigPreviewer",
    () => new JobConfigPreviewer(container.get("artifactPreviewProvider"))
  );

  container.register("jobConfigDraftFilesystem", () => new JobConfigDraftFilesystem());

  container.register(
    "jobConfigDraftManager",
    () => new JobConfigDraftManager(container.get("jobConfigDraftFilesystem"))
  );

  container.register(
    "jobConfigUpdateWorkflow",
    () =>
      new JobConfigUpdateWorkflow(
        container.get("dataService"),
        container.get("jobConfigPreviewer"),
        container.get("jobConfigDraftManager")
      )
  );

  container.register("artifactActionHandler", () => {
    const artifactActionService = new ArtifactActionService(
      container.get("artifactStorageService")
    );
    const artifactPreviewer = new ArtifactPreviewer(
      container.get("artifactRetrievalService") as ArtifactRetrievalService,
      container.get("artifactPreviewProvider"),
      options.artifactPreviewOptionsProvider
    );

    return new DefaultArtifactActionHandler(
      artifactActionService,
      artifactPreviewer,
      options.artifactActionOptionsProvider
    ) as ArtifactActionHandler;
  });

  container.register("watchStore", () => new JenkinsWatchStore(options.context));
  container.register("presetStore", () => new JenkinsParameterPresetStore(options.context));
  container.register("pinStore", () => new JenkinsPinStore(options.context));
  container.register("viewStateStore", () => new JenkinsViewStateStore(options.context));
}
