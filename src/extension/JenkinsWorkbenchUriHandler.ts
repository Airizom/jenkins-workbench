import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash } from "../jenkins/urls";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWorkbenchDeepLinkBuildHandler } from "./JenkinsWorkbenchDeepLinkBuildHandler";
import type { JenkinsWorkbenchDeepLinkJobHandler } from "./JenkinsWorkbenchDeepLinkJobHandler";

interface EnvironmentMatch {
  environment: EnvironmentWithScope;
  normalizedUrl: string;
}

interface EnvironmentPickItem extends vscode.QuickPickItem {
  environment: EnvironmentWithScope;
}

export class JenkinsWorkbenchUriHandler implements vscode.UriHandler {
  constructor(
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly buildHandler: JenkinsWorkbenchDeepLinkBuildHandler,
    private readonly jobHandler: JenkinsWorkbenchDeepLinkJobHandler
  ) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    const action = this.parseAction(uri);
    if (!action) {
      void vscode.window.showErrorMessage(
        "Unsupported Jenkins Workbench link. Use /build?url= or /job?url=."
      );
      return;
    }

    const targetUrlValue = this.getUrlParam(uri);
    if (!targetUrlValue) {
      void vscode.window.showErrorMessage("Missing required 'url' query parameter.");
      return;
    }

    const targetUrl = this.parseHttpUrl(targetUrlValue);
    if (!targetUrl) {
      void vscode.window.showErrorMessage("Invalid Jenkins URL. Expected an http or https URL.");
      return;
    }

    const environment = await this.resolveEnvironment(targetUrl);
    if (!environment) {
      return;
    }

    if (action === "build") {
      await this.buildHandler.openBuildDetails(environment, targetUrl.toString());
      return;
    }

    if (action === "job") {
      await this.jobHandler.revealJob(environment, targetUrl.toString());
    }
  }

  private parseAction(uri: vscode.Uri): "build" | "job" | undefined {
    const segments = uri.path.split("/").filter((segment) => segment.length > 0);
    const actionCandidate =
      segments.length > 0 ? segments[0] : uri.authority?.trim() || undefined;
    if (!actionCandidate) {
      return undefined;
    }
    const action = actionCandidate.toLowerCase();
    switch (action) {
      case "build":
      case "job":
        return action;
      default:
        return undefined;
    }
  }

  private getUrlParam(uri: vscode.Uri): string | undefined {
    const params = new URLSearchParams(uri.query);
    const value = params.get("url")?.trim();
    return value && value.length > 0 ? value : undefined;
  }

  private parseHttpUrl(raw: string): URL | undefined {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async resolveEnvironment(targetUrl: URL): Promise<JenkinsEnvironmentRef | undefined> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      void vscode.window.showErrorMessage(
        "No Jenkins environments are configured. Add one in Jenkins Workbench first."
      );
      return undefined;
    }

    const targetValue = targetUrl.toString();
    const matches: EnvironmentMatch[] = [];

    for (const environment of environments) {
      const normalizedUrl = this.normalizeEnvironmentUrl(environment.url);
      if (!normalizedUrl) {
        continue;
      }
      if (targetValue.startsWith(normalizedUrl)) {
        matches.push({ environment, normalizedUrl });
      }
    }

    if (matches.length === 0) {
      void vscode.window.showErrorMessage(
        "No Jenkins environment matches the provided URL. Verify the base URL in settings."
      );
      return undefined;
    }

    if (matches.length === 1) {
      return this.toEnvironmentRef(matches[0].environment);
    }

    const items: EnvironmentPickItem[] = matches.map((match) => ({
      label: match.normalizedUrl,
      description: match.environment.scope,
      environment: match.environment
    }));

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: "Select the Jenkins environment for this link"
    });

    return selection ? this.toEnvironmentRef(selection.environment) : undefined;
  }

  private normalizeEnvironmentUrl(value: string): string | undefined {
    try {
      return ensureTrailingSlash(new URL(value).toString());
    } catch {
      return undefined;
    }
  }

  private toEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
    return {
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    };
  }
}
