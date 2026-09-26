import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { fullGitRevision } from "../jenkins/JenkinsRevisionEvidence";

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
  private queue: Promise<unknown> = Promise.resolve();

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
    return this.mutate(watch.id, (existing) => (existing ? watch : undefined));
  }

  remove(id: string): Promise<boolean> {
    return this.mutate(id, () => undefined);
  }

  private mutate(
    id: string,
    change: (existing: CommitWatch | undefined) => CommitWatch | undefined
  ): Promise<boolean> {
    const operation = this.queue.then(async () => {
      const watches = this.list();
      const existing = watches.find((watch) => watch.id === id);
      const next = change(existing);
      if (!existing && !next) return false;
      await this.state.update(KEY, [
        ...watches.filter((watch) => watch.id !== id),
        ...(next ? [next] : [])
      ]);
      return true;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
