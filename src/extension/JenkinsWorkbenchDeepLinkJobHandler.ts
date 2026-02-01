import * as vscode from "vscode";
import type { JobPathSegment, JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { buildJobUrl, ensureTrailingSlash, parseJobUrl } from "../jenkins/urls";
import type { DefaultJenkinsTreeNavigator } from "../tree/TreeNavigator";

export class JenkinsWorkbenchDeepLinkJobHandler {
  constructor(private readonly treeNavigator: DefaultJenkinsTreeNavigator) {}

  async revealJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const parsed = parseJobUrl(jobUrl);
    if (!parsed) {
      void vscode.window.showErrorMessage("Unable to parse the job URL from the deep link.");
      return;
    }

    const path = this.buildJobPathSegments(environment, parsed.fullPath);
    if (path.length === 0) {
      void vscode.window.showErrorMessage("Unable to resolve the job path from the URL.");
      return;
    }

    const entry: JobSearchEntry = {
      name: parsed.jobName,
      url: path[path.length - 1]?.url ?? jobUrl,
      kind: "unknown",
      fullName: path.map((segment) => segment.name).join(" / "),
      path
    };

    const revealed = await this.treeNavigator.revealJobPath(environment, entry);
    if (!revealed) {
      void vscode.window.showWarningMessage(
        "Unable to locate the job in the Jenkins Workbench tree."
      );
    }
  }

  private buildJobPathSegments(
    environment: JenkinsEnvironmentRef,
    segments: string[]
  ): JobPathSegment[] {
    const path: JobPathSegment[] = [];
    let parentUrl = ensureTrailingSlash(environment.url);

    for (const segment of segments) {
      const segmentUrl = buildJobUrl(parentUrl, segment);
      path.push({ name: segment, url: segmentUrl, kind: "unknown" });
      parentUrl = segmentUrl;
    }

    return path;
  }
}
