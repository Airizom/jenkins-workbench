import { DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS } from "./CurrentBranchPullRequestJobPatterns";
import type { CurrentBranchPullRequestResolution } from "./CurrentBranchPullRequestService";

export interface CurrentBranchPullRequestJobRef {
  name: string;
  url: string;
  color?: string;
}

export interface CurrentBranchPullRequestJobMatch {
  job: CurrentBranchPullRequestJobRef;
  pullRequest: Extract<CurrentBranchPullRequestResolution, { kind: "pullRequest" }>;
}

export interface CurrentBranchPullRequestJobMatcher {
  findMatch(
    jobs: CurrentBranchPullRequestJobRef[],
    pullRequestContext: CurrentBranchPullRequestResolution
  ): CurrentBranchPullRequestJobMatch | undefined;
}

export class CurrentBranchPullRequestJobNameMatcher implements CurrentBranchPullRequestJobMatcher {
  private jobNamePatterns: readonly string[];

  constructor(
    jobNamePatterns: readonly string[] = DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS
  ) {
    this.jobNamePatterns = normalizeJobNamePatterns(jobNamePatterns);
  }

  updatePatterns(jobNamePatterns: readonly string[]): void {
    this.jobNamePatterns = normalizeJobNamePatterns(jobNamePatterns);
  }

  findMatch(
    jobs: CurrentBranchPullRequestJobRef[],
    pullRequestContext: CurrentBranchPullRequestResolution
  ): CurrentBranchPullRequestJobMatch | undefined {
    if (pullRequestContext.kind !== "pullRequest") {
      return undefined;
    }

    const expectedNames = new Set(
      this.jobNamePatterns
        .map((pattern) => pattern.split("{number}").join(String(pullRequestContext.number)))
        .map(normalizeJobName)
        .filter((pattern) => pattern.length > 0)
    );
    if (expectedNames.size === 0) {
      return undefined;
    }

    const match = jobs.find((job) => expectedNames.has(normalizeJobName(job.name)));
    return match ? { job: match, pullRequest: pullRequestContext } : undefined;
  }
}

function normalizeJobNamePatterns(jobNamePatterns: readonly string[]): readonly string[] {
  const normalized = jobNamePatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
  return normalized.length > 0 ? normalized : DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS;
}

function normalizeJobName(jobName: string): string {
  return decodeJenkinsJobName(jobName).trim().toLowerCase();
}

function decodeJenkinsJobName(jobName: string): string {
  try {
    return decodeURIComponent(jobName);
  } catch {
    return jobName;
  }
}
