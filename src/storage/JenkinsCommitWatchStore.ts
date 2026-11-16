import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { fullGitRevision } from "../jenkins/JenkinsRevisionEvidence";
import { rebaseEnvironmentUrl } from "../jenkins/urls";
import {
  type EnvironmentRecordsCopy,
  type EnvironmentRecordsRef,
  isSameEnvironmentRecordsRef,
  NO_RECORDS_COPIED
} from "./EnvironmentRecordCopy";
import type { EnvironmentRecordStore } from "./EnvironmentRecordParticipant";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import { createSerialTaskQueue } from "./SerialTaskQueue";

export interface CommitWatch {
  id: string;
  repositoryUri: string;
  repositoryLabel: string;
  repositories: string[];
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
  head: string;
  createdAt: number;
  observedBuild?: { url: string; number: number };
  blockedReason?: string;
}

const KEY = "jenkinsWorkbench.commitWatches.v1";

export class JenkinsCommitWatchStore implements EnvironmentRecordStore {
  private readonly mutationQueue = createSerialTaskQueue();

  constructor(private readonly state: vscode.Memento) {}

  list(): CommitWatch[] {
    const stored = this.state.get<unknown>(KEY, []);
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (value): value is CommitWatch =>
        !!value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.repositoryUri === "string" &&
        typeof value.repositoryLabel === "string" &&
        Array.isArray(value.repositories) &&
        value.repositories.every((item: unknown) => typeof item === "string") &&
        !!fullGitRevision(value.head) &&
        typeof value.jobUrl === "string" &&
        typeof value.label === "string" &&
        typeof value.createdAt === "number" &&
        typeof value.environment?.environmentId === "string" &&
        typeof value.environment?.url === "string" &&
        ["workspace", "global"].includes(value.environment?.scope) &&
        (!value.observedBuild ||
          (typeof value.observedBuild.url === "string" &&
            typeof value.observedBuild.number === "number"))
    );
  }

  add(watch: CommitWatch): Promise<boolean> {
    return this.mutate(watch.id, (existing) => existing ?? watch);
  }

  update(watch: CommitWatch): Promise<boolean> {
    // A poll that read the watch before an environment URL rebase or re-point must not write the
    // old URLs or environment back; the next poll evaluates the updated watch instead.
    return this.mutate(
      watch.id,
      (existing) => (existing && !isStaleSnapshot(existing, watch) ? watch : existing),
      { skipIfUnchanged: true }
    );
  }

  remove(id: string): Promise<boolean> {
    return this.mutate(id, () => undefined);
  }

  /**
   * Points an environment's watches at its edited URL: the stored environment URL becomes
   * `newBase`, and job and observed build URLs under any of `oldBases` move onto it.
   */
  rebaseCommitWatchUrls(
    scope: EnvironmentScope,
    environmentId: string,
    oldBases: readonly string[],
    newBase: string
  ): Promise<number> {
    return this.mutationQueue(async () => {
      let moved = 0;
      const watches = this.list().map((watch) => {
        if (
          watch.environment.environmentId !== environmentId ||
          watch.environment.scope !== scope
        ) {
          return watch;
        }
        const observedUrl = watch.observedBuild
          ? rebaseEnvironmentUrl(watch.observedBuild.url, oldBases, newBase)
          : undefined;
        const next: CommitWatch = {
          ...watch,
          environment: { ...watch.environment, url: newBase },
          jobUrl: rebaseEnvironmentUrl(watch.jobUrl, oldBases, newBase) ?? watch.jobUrl,
          observedBuild:
            watch.observedBuild && observedUrl
              ? { ...watch.observedBuild, url: observedUrl }
              : watch.observedBuild
        };
        if (isSameWatch(watch, next)) {
          return watch;
        }
        moved += 1;
        return next;
      });
      if (moved > 0) {
        await this.state.update(KEY, watches);
      }
      return moved;
    });
  }

  /**
   * Re-points an environment's commit watches at another environment id or scope; a watch
   * follows one environment, and this store is per workspace. See EnvironmentRecordsCopy.
   */
  copyEnvironmentRecords(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef
  ): Promise<EnvironmentRecordsCopy> {
    if (isSameEnvironmentRecordsRef(from, to)) {
      return Promise.resolve(NO_RECORDS_COPIED);
    }
    return this.repoint(from, to).then((ids) =>
      ids.length === 0
        ? NO_RECORDS_COPIED
        : {
            copied: ids.length,
            undo: async () => {
              await this.repoint(to, from, new Set(ids));
            }
          }
    );
  }

  /** Removes this workspace's commit watches for an environment. */
  removeEnvironmentRecords(ref: EnvironmentRecordsRef): Promise<void> {
    return this.mutationQueue(async () => {
      const watches = this.list();
      const next = watches.filter(
        (watch) =>
          watch.environment.environmentId !== ref.environmentId ||
          watch.environment.scope !== ref.scope
      );
      if (next.length !== watches.length) {
        await this.state.update(KEY, next);
      }
    });
  }

  private repoint(
    from: EnvironmentRecordsRef,
    to: EnvironmentRecordsRef,
    onlyIds?: ReadonlySet<string>
  ): Promise<string[]> {
    return this.mutationQueue(async () => {
      const moved: string[] = [];
      const watches = this.list().map((watch) => {
        if (
          watch.environment.environmentId !== from.environmentId ||
          watch.environment.scope !== from.scope ||
          (onlyIds && !onlyIds.has(watch.id))
        ) {
          return watch;
        }
        moved.push(watch.id);
        return {
          ...watch,
          environment: { ...watch.environment, environmentId: to.environmentId, scope: to.scope }
        };
      });
      if (moved.length > 0) {
        await this.state.update(KEY, watches);
      }
      return moved;
    });
  }

  private mutate(
    id: string,
    change: (existing: CommitWatch | undefined) => CommitWatch | undefined,
    options: { skipIfUnchanged?: boolean } = {}
  ): Promise<boolean> {
    return this.mutationQueue(async () => {
      const watches = this.list();
      const existing = watches.find((watch) => watch.id === id);
      const next = change(existing);
      if (!existing && !next) return false;
      // Polls re-save every pending watch; avoid a memento write when nothing moved.
      if (options.skipIfUnchanged && existing && next && isSameWatch(existing, next)) return true;
      await this.state.update(KEY, [
        ...watches.filter((watch) => watch.id !== id),
        ...(next ? [next] : [])
      ]);
      return true;
    });
  }
}

function isStaleSnapshot(stored: CommitWatch, incoming: CommitWatch): boolean {
  return (
    stored.environment.url !== incoming.environment.url ||
    stored.environment.environmentId !== incoming.environment.environmentId ||
    stored.environment.scope !== incoming.environment.scope ||
    stored.jobUrl !== incoming.jobUrl
  );
}

function isSameWatch(left: CommitWatch, right: CommitWatch): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
