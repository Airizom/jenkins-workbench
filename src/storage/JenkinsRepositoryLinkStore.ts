import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

interface StoredRepositoryLink {
  environmentId: string;
  scope: JenkinsEnvironmentRef["scope"];
  multibranchFolderUrl: string;
  multibranchLabel: string;
}

interface StoredRepositoryLinksState {
  links?: Record<string, StoredRepositoryLink>;
}

export interface JenkinsRepositoryLinkEnvironment {
  environmentId: string;
  scope: JenkinsEnvironmentRef["scope"];
}

export interface JenkinsRepositoryLink {
  repositoryUri: string;
  environment: JenkinsRepositoryLinkEnvironment;
  multibranchFolderUrl: string;
  multibranchLabel: string;
}

const STATE_KEY = "jenkinsWorkbench.repositoryLinks";

export class JenkinsRepositoryLinkStore {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async migrateLegacyWorkspaceLinks(): Promise<void> {
    const workspaceState = this.getWorkspaceState();
    const globalState = this.getGlobalState();

    const workspaceScopedLinks = {
      ...filterLinksByScope(globalState.links, "workspace"),
      ...filterLinksByScope(workspaceState.links, "workspace")
    };
    const globalScopedLinks = {
      ...filterLinksByScope(workspaceState.links, "global"),
      ...filterLinksByScope(globalState.links, "global")
    };

    const didChange =
      !areLinkMapsEqual(workspaceState.links, workspaceScopedLinks) ||
      !areLinkMapsEqual(globalState.links, globalScopedLinks);
    if (!didChange) {
      return;
    }

    await this.context.workspaceState.update(STATE_KEY, {
      ...workspaceState,
      links: workspaceScopedLinks
    });
    await this.context.globalState.update(STATE_KEY, { ...globalState, links: globalScopedLinks });
    this.emitter.fire();
  }

  getLink(repositoryUri: vscode.Uri | string): JenkinsRepositoryLink | undefined {
    const key = this.toRepositoryKey(repositoryUri);
    const stored = this.getWorkspaceState().links?.[key] ?? this.getGlobalState().links?.[key];
    if (!stored) {
      return undefined;
    }

    return this.toRepositoryLink(key, stored);
  }

  async setLink(
    repositoryUri: vscode.Uri | string,
    link: Omit<JenkinsRepositoryLink, "repositoryUri">
  ): Promise<void> {
    const key = this.toRepositoryKey(repositoryUri);
    const storedLink = this.toStoredRepositoryLink(link);
    if (link.environment.scope === "workspace") {
      await this.updateWorkspaceLinks((links) => {
        links[key] = storedLink;
      });
      await this.updateGlobalLinks((links) => {
        delete links[key];
      });
    } else {
      await this.updateGlobalLinks((links) => {
        links[key] = storedLink;
      });
      await this.updateWorkspaceLinks((links) => {
        delete links[key];
      });
    }
    this.emitter.fire();
  }

  async clearLink(repositoryUri: vscode.Uri | string): Promise<boolean> {
    const key = this.toRepositoryKey(repositoryUri);
    const hasWorkspaceLink = Boolean(this.getWorkspaceState().links?.[key]);
    const hasGlobalLink = Boolean(this.getGlobalState().links?.[key]);
    if (!hasWorkspaceLink && !hasGlobalLink) {
      return false;
    }

    await this.updateWorkspaceLinks((links) => {
      delete links[key];
    });
    await this.updateGlobalLinks((links) => {
      delete links[key];
    });
    this.emitter.fire();
    return true;
  }

  hasLinks(): boolean {
    return Object.keys(this.getState().links ?? {}).length > 0;
  }

  private getState(): StoredRepositoryLinksState {
    return {
      links: {
        ...(this.getGlobalState().links ?? {}),
        ...(this.getWorkspaceState().links ?? {})
      }
    };
  }

  private getGlobalState(): StoredRepositoryLinksState {
    return this.context.globalState.get<StoredRepositoryLinksState>(STATE_KEY) ?? {};
  }

  private getWorkspaceState(): StoredRepositoryLinksState {
    return this.context.workspaceState.get<StoredRepositoryLinksState>(STATE_KEY) ?? {};
  }

  private async updateWorkspaceLinks(
    update: (links: Record<string, StoredRepositoryLink>) => void
  ): Promise<void> {
    const state = this.getWorkspaceState();
    const links = { ...(state.links ?? {}) };
    update(links);
    await this.context.workspaceState.update(STATE_KEY, { ...state, links });
  }

  private async updateGlobalLinks(
    update: (links: Record<string, StoredRepositoryLink>) => void
  ): Promise<void> {
    const state = this.getGlobalState();
    const links = { ...(state.links ?? {}) };
    update(links);
    await this.context.globalState.update(STATE_KEY, { ...state, links });
  }

  private toRepositoryKey(repositoryUri: vscode.Uri | string): string {
    return typeof repositoryUri === "string" ? repositoryUri : repositoryUri.toString();
  }

  private toRepositoryLink(
    repositoryUri: string,
    stored: StoredRepositoryLink
  ): JenkinsRepositoryLink {
    return {
      repositoryUri,
      environment: {
        environmentId: stored.environmentId,
        scope: stored.scope
      },
      multibranchFolderUrl: stored.multibranchFolderUrl,
      multibranchLabel: stored.multibranchLabel
    };
  }

  private toStoredRepositoryLink(
    link: Omit<JenkinsRepositoryLink, "repositoryUri">
  ): StoredRepositoryLink {
    return {
      environmentId: link.environment.environmentId,
      scope: link.environment.scope,
      multibranchFolderUrl: link.multibranchFolderUrl,
      multibranchLabel: link.multibranchLabel
    };
  }
}

function filterLinksByScope(
  links: Record<string, StoredRepositoryLink> | undefined,
  scope: JenkinsEnvironmentRef["scope"]
): Record<string, StoredRepositoryLink> {
  const filtered: Record<string, StoredRepositoryLink> = {};
  for (const [key, link] of Object.entries(links ?? {})) {
    if (link.scope === scope) {
      filtered[key] = link;
    }
  }
  return filtered;
}

function areLinkMapsEqual(
  left: Record<string, StoredRepositoryLink> | undefined,
  right: Record<string, StoredRepositoryLink> | undefined
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}
