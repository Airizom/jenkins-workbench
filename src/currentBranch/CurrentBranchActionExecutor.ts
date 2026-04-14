import type * as vscode from "vscode";
import { withActionErrorMessage } from "../commands/CommandUtils";
import {
  type TriggerBuildForTargetOptions,
  openLastFailedBuildForTarget,
  triggerBuildForTarget
} from "../commands/build/BuildCommandHandlers";
import type { BuildCommandRefreshHost } from "../commands/build/BuildCommandTypes";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { BuildDetailsPanelLauncher } from "../panels/BuildDetailsPanelLauncher";
import type { QueuedBuildWaiter } from "../services/QueuedBuildWaiter";
import type { JenkinsParameterPresetStore } from "../storage/JenkinsParameterPresetStore";
import type {
  CurrentBranchBuildDetailsTarget,
  CurrentBranchJobActionTarget
} from "./CurrentBranchCommandMapper";

export class CurrentBranchActionExecutor {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly presetStore: JenkinsParameterPresetStore,
    private readonly queuedBuildWaiter: QueuedBuildWaiter,
    private readonly buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
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
    _extensionUri: vscode.Uri
  ): Promise<void> {
    await withActionErrorMessage("Unable to open the latest build details", async () => {
      await this.buildDetailsPanelLauncher.show({
        environment: target.environment,
        buildUrl: target.buildUrl,
        label: target.label
      });
    });
  }

  openLastFailedBuild(
    target: CurrentBranchJobActionTarget,
    _extensionUri: vscode.Uri
  ): Promise<void> {
    return openLastFailedBuildForTarget(this.dataService, this.buildDetailsPanelLauncher, target);
  }

  refreshEnvironment(environmentId: string): void {
    this.refreshHost.fullEnvironmentRefresh({ environmentId });
  }
}
