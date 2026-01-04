import type * as vscode from "vscode";
import type { JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { WorkbenchTreeElement } from "./TreeItems";

export interface JenkinsTreeNavigator {
  revealJobPath(environment: JenkinsEnvironmentRef, entry: JobSearchEntry): Promise<boolean>;
}

export interface JenkinsTreeRevealProvider {
  resolveJobElement(
    environment: JenkinsEnvironmentRef,
    entry: JobSearchEntry
  ): Promise<WorkbenchTreeElement | undefined>;
}

export class DefaultJenkinsTreeNavigator implements JenkinsTreeNavigator {
  constructor(
    private readonly treeView: vscode.TreeView<WorkbenchTreeElement>,
    private readonly provider: JenkinsTreeRevealProvider
  ) {}

  async revealJobPath(environment: JenkinsEnvironmentRef, entry: JobSearchEntry): Promise<boolean> {
    try {
      const element = await this.provider.resolveJobElement(environment, entry);
      if (!element) {
        return false;
      }
      await this.treeView.reveal(element, {
        select: true,
        focus: true,
        expand: true
      });
      return true;
    } catch {
      return false;
    }
  }
}
