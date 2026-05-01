import type { JenkinsWorkspaceEntry } from "../../jenkins/JenkinsClient";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { JenkinsRequestError } from "../../jenkins/errors";
import type { TreeJobScope } from "../TreeJobScope";
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import { WorkspaceDirectoryTreeItem, WorkspaceFileTreeItem } from "../items/TreeWorkspaceItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import {
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceRootChildrenKey
} from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeWorkspaceChildrenLoader {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly buildChildrenKey: (
      kind: string,
      environment: JenkinsEnvironmentRef,
      extra?: string
    ) => string,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async loadWorkspaceDirectory(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath?: string
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const entries = await this.dataService.getWorkspaceEntries(environment, jobUrl, relativePath);
      if (entries.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            relativePath ? "Folder is empty." : "Workspace is empty.",
            relativePath
              ? "This workspace directory has no files or folders."
              : "This job workspace has no files or folders."
          )
        ];
      }
      return this.mapWorkspaceEntriesToTreeItems(environment, jobUrl, jobScope, entries);
    } catch (error) {
      const placeholder = this.createWorkspacePlaceholderForError(error, relativePath);
      return [placeholder];
    }
  }

  buildWorkspaceRootChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope
  ): string {
    return buildWorkspaceRootChildrenKey(this.buildChildrenKey, environment, jobUrl, jobScope);
  }

  buildWorkspaceDirectoryChildrenKey(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    relativePath: string
  ): string {
    return buildWorkspaceDirectoryChildrenKey(
      this.buildChildrenKey,
      environment,
      jobUrl,
      jobScope,
      relativePath
    );
  }

  private mapWorkspaceEntriesToTreeItems(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    jobScope: TreeJobScope,
    entries: JenkinsWorkspaceEntry[]
  ): WorkbenchTreeElement[] {
    return entries.map((entry) => {
      if (entry.isDirectory) {
        return new WorkspaceDirectoryTreeItem(
          environment,
          jobUrl,
          entry.relativePath,
          entry.name,
          jobScope
        );
      }
      return new WorkspaceFileTreeItem(
        environment,
        jobUrl,
        entry.relativePath,
        entry.name,
        jobScope
      );
    });
  }

  private createWorkspacePlaceholderForError(
    error: unknown,
    relativePath?: string
  ): PlaceholderTreeItem {
    if (error instanceof JenkinsRequestError && error.statusCode === 404) {
      return this.placeholders.createEmptyPlaceholder(
        relativePath ? "Directory not found." : "Workspace unavailable.",
        relativePath
          ? "This workspace directory no longer exists in Jenkins."
          : "Jenkins did not expose a current workspace for this job."
      );
    }

    return this.placeholders.createErrorPlaceholder(
      relativePath ? "Unable to load workspace directory." : "Unable to load workspace.",
      error
    );
  }
}
