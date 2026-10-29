import * as vscode from "vscode";
import type { JenkinsEnvironmentUrlResolver } from "./JenkinsEnvironmentUrlResolver";
import type { JenkinsWorkbenchDeepLinkBuildHandler } from "./JenkinsWorkbenchDeepLinkBuildHandler";
import type { JenkinsWorkbenchDeepLinkJobHandler } from "./JenkinsWorkbenchDeepLinkJobHandler";
import { parseWorkbenchDeepLink } from "./WorkbenchDeepLinks";

export class JenkinsWorkbenchUriHandler implements vscode.UriHandler {
  constructor(
    private readonly environmentResolver: JenkinsEnvironmentUrlResolver,
    private readonly buildHandler: JenkinsWorkbenchDeepLinkBuildHandler,
    private readonly jobHandler: JenkinsWorkbenchDeepLinkJobHandler
  ) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const link = parseWorkbenchDeepLink(this.getActionCandidate(uri), uri.query);
    if (!link.ok) {
      void vscode.window.showErrorMessage(link.message);
      return;
    }

    const resolved = await this.environmentResolver.resolve(link.url);
    if (!resolved) {
      return;
    }
    const { environment } = resolved;

    if (link.action === "build") {
      await this.buildHandler.openBuildDetails(
        environment,
        link.url.toString(),
        link.nodeSelection
      );
      return;
    }

    await this.jobHandler.revealJob(environment, link.url.toString());
  }

  private getActionCandidate(uri: vscode.Uri): string | undefined {
    const segments = uri.path.split("/").filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments[0] : uri.authority?.trim() || undefined;
  }
}
