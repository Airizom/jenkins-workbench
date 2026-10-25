import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, rebaseEnvironmentUrl } from "../jenkins/urls";
import { createSerialTaskQueue } from "./SerialTaskQueue";
import { getScopedMemento, toRepositoryKey } from "./StorageScope";

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
    const key = toRepositoryKey(repositoryUri);
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
      const key = toRepositoryKey(repositoryUri);
      const storedLink = this.toStoredRepositoryLink(link);
      const targetScope = link.environment.scope;
      const otherScope = targetScope === "workspace" ? "global" : "workspace";
      await this.updateLinks(targetScope, (links) => {
        links[key] = storedLink;
      });
      await this.updateLinks(otherScope, (links) => {
        delete links[key];
      });
      this.emitter.fire();
    });
  }

  async clearLink(repositoryUri: vscode.Uri | string): Promise<boolean> {
    return this.mutationQueue(async () => {
      const key = toRepositoryKey(repositoryUri);
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

  /**
   * Moves the multibranch folder URLs of an environment's links from any of `oldBases` onto
   * `newBase` after its URL was edited. Both mementos are checked, as links record their scope.
   */
  rebaseLinkUrls(
    environment: JenkinsRepositoryLinkEnvironment,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    return this.mutationQueue(async () => {
      let moved = 0;
      for (const scope of ["workspace", "global"] as const) {
        const state = scope === "workspace" ? this.getWorkspaceState() : this.getGlobalState();
        const rebased = rebaseRepositoryLinks(state.links ?? {}, environment, oldBases, newBase);

        const count = Object.keys(rebased).length;
        if (count > 0) {
          await this.updateLinks(scope, (links) => Object.assign(links, rebased));
          moved += count;
        }
      }

      if (moved > 0) {
        this.emitter.fire();
      }
      return moved;
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
    const memento = getScopedMemento(this.context, scope);
    const links = { ...(state.links ?? {}) };
    update(links);
    await memento.update(STATE_KEY, { ...state, links });
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

function rebaseRepositoryLinks(
  links: Record<string, StoredRepositoryLink>,
  environment: JenkinsRepositoryLinkEnvironment,
  oldBases: readonly string[],
  newBase: string
): Record<string, StoredRepositoryLink> {
  const rebased: Record<string, StoredRepositoryLink> = {};
  for (const [key, link] of Object.entries(links)) {
    const multibranchFolderUrl =
      link.environmentId === environment.environmentId && link.scope === environment.scope
        ? rebaseEnvironmentUrl(link.multibranchFolderUrl, oldBases, newBase)
        : undefined;
    if (multibranchFolderUrl) {
      rebased[key] = { ...link, multibranchFolderUrl };
    }
  }
  return rebased;
}
