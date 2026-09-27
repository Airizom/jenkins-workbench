import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JobHistoryPanelLauncher } from "../panels/JobHistoryPanelLauncher";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsFolderTreeItem, JobTreeItem } from "../tree/TreeItems";
import { toJenkinsEnvironmentRef, withActionErrorMessage } from "./CommandUtils";

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
          entries.map((entry) => ({ label: entry.url, entry })),
          { title: "Choose Jenkins environment" }
        );
        if (!chosen) return;
        const environment = toJenkinsEnvironmentRef(chosen.entry);
        const jobs = await data.getAllJobsForEnvironment(environment);
        const selected = await vscode.window.showQuickPick(
          jobs.map((job) => ({ label: job.fullName, url: job.url })),
          { title: "Choose job for history", matchOnDescription: true }
        );
        if (selected) await launcher.show(environment, selected.url);
      })
    )
  );
}
