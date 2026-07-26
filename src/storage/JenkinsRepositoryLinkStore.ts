import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash } from "../jenkins/urls";
import { createSerialTaskQueue } from "./SerialTaskQueue";

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
  private readonly mutationQueue = createSerialTaskQueue();
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  // fallow-ignore-next-line unused-class-member
  async migrateLegacyWorkspaceLinks(): Promise<void> {
    await this.mutationQueue(async () => {
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
      await this.context.globalState.update(STATE_KEY, {
        ...globalState,
        links: globalScopedLinks
      });
      this.emitter.fire();
    });
  }

  getLink(repositoryUri: vscode.Uri | string): JenkinsRepositoryLink | undefined {
    const key = this.toRepositoryKey(repositoryUri);
    const stored = this.getWorkspaceState().links?.[key] ?? this.getGlobalState().links?.[key];
    if (!stored) {
      return undefined;
    }

    return this.toRepositoryLink(key, stored);
  }

  listLinks(): readonly JenkinsRepositoryLink[] {
    return Object.entries(this.getState().links ?? {}).map(([repositoryUri, stored]) =>
      this.toRepositoryLink(repositoryUri, stored)
    );
  }

  findLinksForEnvironment(
    environment: JenkinsRepositoryLinkEnvironment
  ): readonly JenkinsRepositoryLink[] {
    return this.listLinks().filter(
      (link) =>
        link.environment.environmentId === environment.environmentId &&
        link.environment.scope === environment.scope
    );
  }

  findLinksForMultibranch(
    environment: JenkinsRepositoryLinkEnvironment,
    multibranchFolderUrl: string
  ): readonly JenkinsRepositoryLink[] {
    const normalizedTarget = normalizeLinkUrl(multibranchFolderUrl);
    return this.findLinksForEnvironment(environment).filter(
      (link) => normalizeLinkUrl(link.multibranchFolderUrl) === normalizedTarget
    );
  }

  async setLink(
    repositoryUri: vscode.Uri | string,
    link: Omit<JenkinsRepositoryLink, "repositoryUri">
  ): Promise<void> {
    await this.mutationQueue(async () => {
      const key = this.toRepositoryKey(repositoryUri);
      const storedLink = this.toStoredRepositoryLink(link);
      if (link.environment.scope === "workspace") {
        await this.updateLinks("workspace", (links) => {
          links[key] = storedLink;
        });
        await this.updateLinks("global", (links) => {
          delete links[key];
        });
      } else {
        await this.updateLinks("global", (links) => {
          links[key] = storedLink;
        });
        await this.updateLinks("workspace", (links) => {
          delete links[key];
        });
      }
      this.emitter.fire();
    });
  }

  async clearLink(repositoryUri: vscode.Uri | string): Promise<boolean> {
    return this.mutationQueue(async () => {
      const key = this.toRepositoryKey(repositoryUri);
      const hasWorkspaceLink = Boolean(this.getWorkspaceState().links?.[key]);
      const hasGlobalLink = Boolean(this.getGlobalState().links?.[key]);
      if (!hasWorkspaceLink && !hasGlobalLink) {
        return false;
      }

      await this.updateLinks("workspace", (links) => {
        delete links[key];
      });
      await this.updateLinks("global", (links) => {
        delete links[key];
      });
      this.emitter.fire();
      return true;
    });
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

  private async updateLinks(
    scope: JenkinsEnvironmentRef["scope"],
    update: (links: Record<string, StoredRepositoryLink>) => void
  ): Promise<void> {
    const state = scope === "workspace" ? this.getWorkspaceState() : this.getGlobalState();
    const memento = scope === "workspace" ? this.context.workspaceState : this.context.globalState;
    const links = { ...(state.links ?? {}) };
    update(links);
    await memento.update(STATE_KEY, { ...state, links });
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

function normalizeLinkUrl(value: string): string {
  try {
    return new URL(ensureTrailingSlash(value)).toString();
  } catch {
    return ensureTrailingSlash(value);
  }
}
