import * as vscode from "vscode";
import { formatEnvironmentDisplayName } from "../jenkins/EnvironmentLabels";
import { CancellationError } from "../jenkins/errors";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import { toJenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JobHistoryPanelLauncher } from "../panels/JobHistoryPanelLauncher";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsFolderTreeItem, JobTreeItem } from "../tree/TreeItems";
import { withActionErrorMessage } from "./CommandUtils";

const JOB_HISTORY_PICKER_MAX_RESULTS = 2000;

export function registerHistoryCommands(
  context: vscode.ExtensionContext,
  data: JenkinsDataService,
  environments: JenkinsEnvironmentStore,
  launcher: JobHistoryPanelLauncher
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.openJobHistory", (item?: unknown) =>
      withActionErrorMessage("Unable to open Job History", async () => {
        if (item instanceof JobTreeItem) {
          await launcher.show(item.environment, item.jobUrl);
          return;
        }
        if (item instanceof JenkinsFolderTreeItem && item.folderKind === "multibranch") {
          const jobs = await data.getJobsForFolder(item.environment, item.folderUrl);
          const selected = await vscode.window.showQuickPick(
            jobs
              .filter((job) => job.kind !== "folder" && job.kind !== "multibranch")
              .map((job) => ({ label: job.name, url: job.url })),
            { title: "Choose branch for Job History" }
          );
          if (selected) await launcher.show(item.environment, selected.url);
          return;
        }
        const entries = await environments.listEnvironmentsWithScope();
        const chosen = await vscode.window.showQuickPick(
          entries.map((entry) => ({
            label: formatEnvironmentDisplayName(entry),
            description: entry.username ? `${entry.scope} · ${entry.username}` : entry.scope,
            entry
          })),
          { title: "Choose Jenkins environment", matchOnDescription: true }
        );
        if (!chosen) return;
        const environment = toJenkinsEnvironmentRef(chosen.entry);
        const jobs = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Loading Jenkins jobs for Job History",
            cancellable: true
          },
          (_progress, token) =>
            data
              .getAllJobsForEnvironment(environment, {
                cancellation: token,
                concurrency: 1,
                maxResults: JOB_HISTORY_PICKER_MAX_RESULTS
              })
              .catch((error: unknown) => {
                // Cancelling the progress notification is a normal close, not a failure.
                if (token.isCancellationRequested || error instanceof CancellationError) {
                  return undefined;
                }
                throw error;
              })
        );
        if (!jobs) return;
        const selected = await vscode.window.showQuickPick(
          jobs.map((job) => ({ label: job.fullName, url: job.url })),
          { title: "Choose job for history", matchOnDescription: true }
        );
        if (selected) await launcher.show(environment, selected.url);
      })
    )
  );
}
