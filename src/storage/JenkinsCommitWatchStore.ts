import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { fullGitRevision } from "../jenkins/JenkinsRevisionEvidence";
import { rebaseEnvironmentUrl } from "../jenkins/urls";
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

export class JenkinsCommitWatchStore {
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
    // A poll that read the watch before an environment URL rebase must not write the old URLs
    // back; the next poll evaluates the rebased watch instead.
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
  return stored.environment.url !== incoming.environment.url || stored.jobUrl !== incoming.jobUrl;
}

function isSameWatch(left: CommitWatch, right: CommitWatch): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
