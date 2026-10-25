import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsReplaySubmissionPayload } from "../../jenkins/types";
import { buildActionUrl } from "../../jenkins/urls";
import type { BuildFollowUpService } from "../../services/buildFollow/BuildFollowUpService";
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
  /** Job label for follow-up messages; derived from the build URL when absent. */
  jobLabel?: string;
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
    private readonly buildFollowUp: Pick<BuildFollowUpService, "prepare" | "announceAndFollow">
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
      const { follow, result } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running local Jenkinsfile replay for ${target.label}...`,
          cancellable: false
        },
        async () => {
          // Read the next build number before submitting so the new build can be told apart.
          const follow = await this.buildFollowUp.prepare({
            kind: "cause",
            environment: target.environment,
            sourceBuildUrl: target.buildUrl,
            cause: "replay",
            jobLabel: target.jobLabel,
            mayReturnQueueItem: true
          });
          const result = await this.dataService.runReplay(
            target.environment,
            target.buildUrl,
            payload
          );
          return { follow, result };
        }
      );
      const location = result.location ?? result.queueLocation ?? result.buildLocation;
      this.buildFollowUp.announceAndFollow(follow, {
        location,
        requestedMessage: `Local Jenkinsfile replay requested for ${target.label}`,
        plainMessage: location
          ? `Local Jenkinsfile replay started for ${target.label}. Location: ${location}`
          : `Local Jenkinsfile replay started for ${target.label}.`,
        refresh: () =>
          refreshHost.fullEnvironmentRefresh({ environmentId: target.environment.environmentId })
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
          : getTreeItemLabel(selection),
        jobLabel: selection.jobNameHint
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
      label: `${selection.label} #${completed.number}`,
      jobLabel: selection.label
    };
  }
}

function isBuildInput(
  input: BuildTreeItem | LocalReplayJobTarget | vscode.Uri | undefined
): input is BuildTreeItem {
  return input !== undefined && "buildUrl" in input;
}
