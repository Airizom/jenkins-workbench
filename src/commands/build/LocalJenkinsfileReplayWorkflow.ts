import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsReplaySubmissionPayload } from "../../jenkins/types";
import { buildActionUrl } from "../../jenkins/urls";
import type { QueuedBuildWaiter } from "../../services/QueuedBuildWaiter";
import type { BuildTreeItem } from "../../tree/TreeItems";
import { formatActionError, getTreeItemLabel } from "../CommandUtils";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";

export interface LocalReplaySourceResolver {
  resolve(uri?: vscode.Uri): Promise<vscode.Uri | undefined>;
  readContent(uri: vscode.Uri): Promise<string>;
}

export interface LocalReplayJobTarget {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
}

export interface LocalReplayJobPicker {
  pick(sourceUri: vscode.Uri): Promise<LocalReplayJobTarget | undefined>;
}

interface LocalReplayBuildTarget {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label: string;
}

interface PreparedLocalReplay {
  target: LocalReplayBuildTarget;
  payload: JenkinsReplaySubmissionPayload;
}

export class LocalJenkinsfileReplayWorkflow {
  private inFlight = false;

  constructor(
    private readonly dataService: Pick<
      JenkinsDataService,
      "getJob" | "getReplayDefinition" | "runReplay"
    >,
    private readonly sourceResolver: LocalReplaySourceResolver,
    private readonly jobPicker: LocalReplayJobPicker,
    private readonly queuedBuildWaiter: Pick<QueuedBuildWaiter, "awaitQueuedBuildStart">
  ) {}

  async run(
    refreshHost: BuildCommandRefreshHost,
    input?: BuildTreeItem | vscode.Uri
  ): Promise<void> {
    if (this.inFlight) {
      void vscode.window.showInformationMessage(
        "A local Jenkinsfile replay is already in progress."
      );
      return;
    }

    this.inFlight = true;
    let preparationToken: vscode.CancellationToken | undefined;
    try {
      const build = isBuildInput(input) ? input : undefined;
      const sourceUri = await this.sourceResolver.resolve(
        build ? undefined : (input as vscode.Uri | undefined)
      );
      if (!sourceUri) {
        return;
      }

      const selection = build ?? (await this.jobPicker.pick(sourceUri));
      if (!selection) {
        return;
      }

      const prepared = await vscode.window.withProgress<PreparedLocalReplay | undefined>(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Preparing replay with local Jenkinsfile...",
          cancellable: true
        },
        async (_progress, token) => {
          preparationToken = token;
          if (token.isCancellationRequested) {
            return undefined;
          }
          const target = await this.resolveBuildTarget(selection);
          if (token.isCancellationRequested) {
            return undefined;
          }
          const definition = await this.dataService.getReplayDefinition(
            target.environment,
            target.buildUrl
          );
          if (token.isCancellationRequested) {
            return undefined;
          }
          const mainScript = await this.sourceResolver.readContent(sourceUri);
          if (token.isCancellationRequested) {
            return undefined;
          }
          if (!mainScript.trim()) {
            throw new Error("The local Jenkinsfile is empty.");
          }
          return {
            target,
            payload: {
              mainScript,
              loadedScripts: definition.loadedScripts.map(({ postField, script }) => ({
                postField,
                script
              }))
            }
          };
        }
      );
      if (!prepared || preparationToken?.isCancellationRequested) {
        return;
      }

      const { target, payload } = prepared;
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running local Jenkinsfile replay for ${target.label}...`,
          cancellable: false
        },
        () => this.dataService.runReplay(target.environment, target.buildUrl, payload)
      );
      const location = result.location ?? result.queueLocation ?? result.buildLocation;
      void vscode.window.showInformationMessage(
        location
          ? `Local Jenkinsfile replay started for ${target.label}. Location: ${location}`
          : `Local Jenkinsfile replay started for ${target.label}.`
      );
      void this.waitForReplayAndRefresh(target, refreshHost, location).catch((error) => {
        console.warn(
          `Failed to refresh local Jenkinsfile replay state for ${target.label}.`,
          error
        );
      });
    } catch (error) {
      if (!preparationToken?.isCancellationRequested) {
        void vscode.window.showErrorMessage(
          `Failed to replay with local Jenkinsfile: ${formatActionError(error)}`
        );
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async resolveBuildTarget(
    selection: BuildTreeItem | LocalReplayJobTarget
  ): Promise<LocalReplayBuildTarget> {
    if (isBuildInput(selection)) {
      return {
        environment: selection.environment,
        buildUrl: selection.buildUrl,
        label: selection.jobNameHint
          ? `${selection.jobNameHint} ${getTreeItemLabel(selection)}`
          : getTreeItemLabel(selection)
      };
    }

    const job = await this.dataService.getJob(selection.environment, selection.jobUrl);
    const completed = job.lastCompletedBuild;
    if (
      !completed ||
      !Number.isInteger(completed.number) ||
      completed.number <= 0 ||
      completed.building
    ) {
      throw new Error(
        `${selection.label} has no completed build to replay. Run the Pipeline once in Jenkins first.`
      );
    }
    return {
      environment: selection.environment,
      buildUrl: buildActionUrl(selection.jobUrl, `${completed.number}/`),
      label: `${selection.label} #${completed.number}`
    };
  }

  private async waitForReplayAndRefresh(
    target: LocalReplayBuildTarget,
    refreshHost: BuildCommandRefreshHost,
    location: string | undefined
  ): Promise<void> {
    try {
      await this.queuedBuildWaiter.awaitQueuedBuildStart(target.environment, location);
    } finally {
      refreshHost.fullEnvironmentRefresh({ environmentId: target.environment.environmentId });
    }
  }
}

function isBuildInput(
  input: BuildTreeItem | LocalReplayJobTarget | vscode.Uri | undefined
): input is BuildTreeItem {
  return input !== undefined && "buildUrl" in input;
}
