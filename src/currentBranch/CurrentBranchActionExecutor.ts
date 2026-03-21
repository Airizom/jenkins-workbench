import type * as vscode from "vscode";
import { withActionErrorMessage } from "../commands/CommandUtils";
import {
  type TriggerBuildForTargetOptions,
  openLastFailedBuildForTarget,
  triggerBuildForTarget
} from "../commands/build/BuildCommandHandlers";
import type { BuildCommandRefreshHost } from "../commands/build/BuildCommandTypes";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { BuildDetailsPanel } from "../panels/BuildDetailsPanel";
import type { PendingInputActionProvider } from "../panels/buildDetails/BuildDetailsPollingController";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type {
  CurrentBranchBuildDetailsTarget,
  CurrentBranchJobActionTarget
} from "./CurrentBranchCommandMapper";

export class CurrentBranchActionExecutor {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly presetStore: JenkinsParameterPresetStore,
    private readonly queuedBuildWaiter: QueuedBuildWaiter,
    private readonly artifactActionHandler: ArtifactActionHandler,
    private readonly consoleExporter: BuildConsoleExporter,
    private readonly pendingInputProvider: PendingInputActionProvider,
    private readonly refreshHost: BuildCommandRefreshHost
  ) {}

  triggerBuild(
    target: CurrentBranchJobActionTarget,
    options?: TriggerBuildForTargetOptions
  ): Promise<void> {
    return triggerBuildForTarget(
      this.dataService,
      this.presetStore,
      this.queuedBuildWaiter,
      this.refreshHost,
      target,
      options
    );
  }

  async openLatestBuild(
    target: CurrentBranchBuildDetailsTarget,
    extensionUri: vscode.Uri
  ): Promise<void> {
    await withActionErrorMessage("Unable to open the latest build details", async () => {
      await BuildDetailsPanel.show({
        dataService: this.dataService,
        artifactActionHandler: this.artifactActionHandler,
        consoleExporter: this.consoleExporter,
        refreshHost: this.refreshHost,
        pendingInputProvider: this.pendingInputProvider,
        environment: target.environment,
        buildUrl: target.buildUrl,
        extensionUri,
        label: target.label
      });
    });
  }

  openLastFailedBuild(
    target: CurrentBranchJobActionTarget,
    extensionUri: vscode.Uri
  ): Promise<void> {
    return openLastFailedBuildForTarget(
      this.dataService,
      this.artifactActionHandler,
      this.consoleExporter,
      this.refreshHost,
      this.pendingInputProvider,
      extensionUri,
      target
    );
  }

  refreshEnvironment(environmentId: string): void {
    this.refreshHost.fullEnvironmentRefresh({ environmentId });
  }
}
