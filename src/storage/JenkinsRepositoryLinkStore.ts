import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, rebaseEnvironmentUrl } from "../jenkins/urls";
import {
  type EnvironmentRecordsCopy,
  type EnvironmentRecordsRef,
  isSameEnvironmentRecordsRef,
  NO_RECORDS_COPIED
} from "./EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "./EnvironmentRecordParticipant";
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

interface LinkWrite {
  scope: JenkinsEnvironmentRef["scope"];
  key: string;
  previous: StoredRepositoryLink | undefined;
  next: StoredRepositoryLink | undefined;
}

const STATE_KEY = "jenkinsWorkbench.repositoryLinks";

export class JenkinsRepositoryLinkStore implements EnvironmentRecordStore {
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
      const hasLink = (["workspace", "global"] as const).some((scope) =>
        Boolean(this.getScopeState(scope).links?.[key])
      );
      if (!hasLink) {
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
          // eslint-disable-next-line react-doctor/async-await-in-loop -- Apply each scope update in order and stop if a memento write fails.
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

  /**
   * Re-points an environment's repository links at another environment id or scope (a
   * repository links to one environment). Links move into the target scope's memento, except
   * that a user-wide link stays for other workspaces when the target is workspace-scoped; the
   * workspace copy takes precedence here. A repository already linked in the target memento
   * keeps that link. See EnvironmentRecordsCopy.
   */
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    if (isSameEnvironmentRecordsRef(from, to)) {
      return Promise.resolve(NO_RECORDS_COPIED);
    }
    return this.mutationQueue(async () => {
      const writes: LinkWrite[] = [];
      const targetLinks = this.getScopeState(to.scope).links ?? {};
      // Keys a workspace link was moved to in the global memento; that link took precedence.
      const movedToGlobal = new Set<string>();
      // Workspace first: it shadows the global memento, so its link wins a shared key.
      for (const scope of ["workspace", "global"] as const) {
        const matching = Object.entries(this.getScopeState(scope).links ?? {}).filter(
          ([, link]) => link.environmentId === from.environmentId && link.scope === from.scope
        );
        for (const [key, link] of matching) {
          const next = { ...link, environmentId: to.environmentId, scope: to.scope };
          if (scope === to.scope) {
            if (!movedToGlobal.has(key)) {
              writes.push({ scope, key, previous: link, next });
            }
          } else if (to.scope === "global") {
            // A workspace link would shadow the global one, so move it as setLink does.
            writes.push({ scope: "global", key, previous: targetLinks[key], next });
            writes.push({ scope, key, previous: link, next: undefined });
            movedToGlobal.add(key);
          } else if (!targetLinks[key]) {
            writes.push({ scope: "workspace", key, previous: undefined, next });
          }
        }
      }
      if (writes.length === 0) {
        return NO_RECORDS_COPIED;
      }
      await this.applyLinkWrites(writes);
      this.emitter.fire();
      return {
        copied: new Set(writes.map((write) => write.key)).size,
        undo: () => this.undoLinkWrites(writes)
      };
    });
  }

  /**
   * Removes the links to an environment from its scope's memento: user-wide for a global
   * environment, this workspace's for a workspace one. Links re-pointed at another environment no
   * longer match and stay.
   */
  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    return this.mutationQueue(async () => {
      const links = this.getScopeState(ref.scope).links ?? {};
      const keys = Object.keys(links).filter(
        (key) => links[key].environmentId === ref.environmentId && links[key].scope === ref.scope
      );
      if (keys.length === 0) {
        return;
      }
      await this.updateLinks(ref.scope, (next) => {
        for (const key of keys) {
          delete next[key];
        }
      });
      this.emitter.fire();
    });
  }

  private undoLinkWrites(writes: readonly LinkWrite[]): Promise<void> {
    return this.mutationQueue(async () => {
      const reverts = writes
        .filter(
          (write) =>
            JSON.stringify(this.getScopeState(write.scope).links?.[write.key]) ===
            JSON.stringify(write.next)
        )
        .map((write) => ({ ...write, previous: write.next, next: write.previous }));
      if (reverts.length > 0) {
        await this.applyLinkWrites(reverts);
        this.emitter.fire();
      }
    });
  }

  private async applyLinkWrites(writes: readonly LinkWrite[]): Promise<void> {
    for (const scope of ["global", "workspace"] as const) {
      const inScope = writes.filter((write) => write.scope === scope);
      if (inScope.length === 0) {
        continue;
      }
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Restore scoped links in order and stop if a memento write fails.
      await this.updateLinks(scope, (links) => {
        for (const { key, next } of inScope) {
          if (next) {
            links[key] = next;
          } else {
            delete links[key];
          }
        }
      });
    }
  }

  private getScopeState(scope: JenkinsEnvironmentRef["scope"]): StoredRepositoryLinksState {
    return scope === "workspace" ? this.getWorkspaceState() : this.getGlobalState();
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
