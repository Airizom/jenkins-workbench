import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  assessBuildRevision,
  type RevisionAssessment,
  type RevisionEvidence
} from "../jenkins/JenkinsRevisionEvidence";
import type { JenkinsBuild, JenkinsJob } from "../jenkins/types";
import type { CurrentBranchCheckout } from "./CurrentBranchCheckout";

export const COMMIT_HISTORY_LIMIT = 50;

export interface CommitHistory {
  job: JenkinsJob;
  builds: JenkinsBuild[];
  lastPass?: JenkinsBuild;
  error?: string;
  lastPassError?: string;
}

export interface VerifiedCommitBuild {
  build: JenkinsBuild;
  evidence: RevisionEvidence;
}

export interface CommitAssessment {
  kind: "verified" | "unverified" | "notFound";
  current?: VerifiedCommitBuild;
  lastPass?: { build: JenkinsBuild; assessment: RevisionAssessment };
  reason: string;
}

export function assessCommit(
  history: CommitHistory,
  checkout: CurrentBranchCheckout
): CommitAssessment {
  const assessed = history.builds
    .map((build) => ({ build, assessment: assessBuildRevision(build, checkout.repositories) }))
    .sort((left, right) => right.build.number - left.build.number);
  const match = assessed.find(
    ({ assessment }) =>
      assessment.kind === "verified" && assessment.evidence.revision === checkout.head
  );
  const lastPass = history.lastPass
    ? {
        build: history.lastPass,
        assessment: assessBuildRevision(history.lastPass, checkout.repositories)
      }
    : undefined;
  if (match?.assessment.kind === "verified" && !history.error) {
    return {
      kind: "verified",
      current: { build: match.build, evidence: match.assessment.evidence },
      lastPass,
      reason: "Repository and full commit verified"
    };
  }
  const latest = assessed[0]?.assessment;
  const reason =
    history.error ??
    (!checkout.head
      ? "Local HEAD revision unavailable"
      : latest?.kind === "unverified"
        ? latest.reason
        : undefined);
  return {
    kind: reason ? "unverified" : "notFound",
    lastPass,
    reason:
      reason ?? `No verified build for current commit in the newest ${COMMIT_HISTORY_LIMIT} builds`
  };
}

/** Shared job reads bound polling traffic, independent of the locally selected HEAD. */
export class CurrentBranchCommitHistory {
  private readonly pending = new Map<string, Promise<CommitHistory>>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly dataService: JenkinsDataService) {}

  load(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<CommitHistory> {
    const key = `${environment.scope}\0${environment.environmentId}\0${environment.url}\0${jobUrl}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.read(environment, jobUrl).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async read(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<CommitHistory> {
    if (this.active >= 3) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      const job = await this.dataService.getJob(environment, jobUrl);
      try {
        const builds = await this.dataService.getBuildsForJob(
          environment,
          jobUrl,
          COMMIT_HISTORY_LIMIT,
          { detailLevel: "revisions", bypassCache: true }
        );
        const pass = job.lastSuccessfulBuild;
        let lastPass = builds.find((build) => build.number === pass?.number);
        let lastPassError: string | undefined;
        if (pass?.url && !lastPass) {
          try {
            lastPass = await this.dataService.getBuildDetails(environment, pass.url, {
              revisionsOnly: true,
              bypassCache: true
            });
          } catch {
            lastPassError = `Last passing build #${pass.number}: revision unavailable`;
          }
        }
        return { job, builds, lastPass, lastPassError };
      } catch (error) {
        return {
          job,
          builds: [],
          error: `Revision verification unavailable: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}
