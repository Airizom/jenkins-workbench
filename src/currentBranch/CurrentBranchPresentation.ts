import { formatJobColor, formatRelativeTime } from "../tree/formatters";
import type { CurrentBranchState } from "./CurrentBranchJenkinsService";
import type { CurrentBranchPullRequestInfo } from "./CurrentBranchTypes";

export function formatCurrentBranchJobLabel(
  state: Extract<CurrentBranchState, { kind: "matched" | "branchMissing" }>
): string {
  const pullRequestLabel =
    state.kind === "matched" ? formatPullRequestLabel(state.pullRequest) : undefined;
  if (state.kind === "matched" && state.resolvedTargetKind === "pullRequest" && pullRequestLabel) {
    return `${state.link.multibranchLabel} / ${pullRequestLabel}`;
  }

  const branch = state.branchName?.trim();
  return branch ? `${state.link.multibranchLabel} / ${branch}` : state.link.multibranchLabel;
}

export function formatCurrentBranchBuildDetailsLabel(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): string {
  const buildNumber = state.lastBuild?.number;
  return buildNumber ? `#${buildNumber}` : formatCurrentBranchJobLabel(state);
}

export function formatCurrentBranchTooltip(
  state: Exclude<
    CurrentBranchState,
    { kind: "noGit" | "noRepository" | "ambiguousRepository" | "unlinked" }
  >
): string {
  switch (state.kind) {
    case "matched":
      return formatMatchedTooltip(state);
    case "branchMissing":
      return [
        `Linked multibranch: ${state.link.multibranchLabel}`,
        `Repository: ${state.repository.repositoryLabel}`,
        `Branch: ${state.branchName}`,
        "Status: Branch not found in Jenkins"
      ].join("\n");
    case "requestFailed":
      return [
        ...(state.link ? [`Linked multibranch: ${state.link.multibranchLabel}`] : []),
        ...(state.repository ? [`Repository: ${state.repository.repositoryLabel}`] : []),
        ...(state.branchName ? [`Branch: ${state.branchName}`] : []),
        ...formatSelectedTargetLines(state.selectedTarget),
        `Error: ${state.message}`
      ].join("\n");
    case "detachedHead":
      return [
        `Linked multibranch: ${state.link.multibranchLabel}`,
        `Repository: ${state.repository.repositoryLabel}`,
        "Check out a branch to resolve the current Jenkins job."
      ].join("\n");
  }
}

export function isCurrentBranchBuilding(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): boolean {
  return state.jobColor?.endsWith("_anime") === true || state.lastBuild?.building === true;
}

function formatMatchedTooltip(state: Extract<CurrentBranchState, { kind: "matched" }>): string {
  const lines = [
    `Linked multibranch: ${state.link.multibranchLabel}`,
    `Repository: ${state.repository.repositoryLabel}`,
    `Branch: ${state.branchName}`,
    `Job: ${state.jobName}`
  ];

  const pullRequestSummary = formatPullRequestSummary(state.pullRequest);
  if (pullRequestSummary) {
    lines.splice(3, 0, pullRequestSummary);
  }

  const statusLabel = formatJobColor(state.jobColor);
  if (statusLabel) {
    lines.push(`Status: ${statusLabel}`);
  }

  const buildSummary = formatLastBuildSummary(state);
  if (buildSummary) {
    lines.push(`Last build: ${buildSummary}`);
  }

  return lines.join("\n");
}

function formatLastBuildSummary(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): string | undefined {
  const build = state.lastBuild;
  if (!build) {
    return undefined;
  }

  const parts: string[] = [];
  if (typeof build.number === "number") {
    parts.push(`#${build.number}`);
  }

  const resultLabel = build.building ? "Running" : (build.result ?? undefined);
  if (resultLabel) {
    parts.push(resultLabel);
  }

  const timeLabel =
    typeof build.timestamp === "number" ? formatRelativeTime(build.timestamp) : undefined;
  if (timeLabel) {
    parts.push(timeLabel);
  }

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function formatPullRequestSummary(
  pullRequest: CurrentBranchPullRequestInfo | undefined
): string | undefined {
  if (!pullRequest) {
    return undefined;
  }

  const pullRequestLabel = formatPullRequestLabel(pullRequest);
  return pullRequest.title ? `${pullRequestLabel}: ${pullRequest.title}` : pullRequestLabel;
}

function formatSelectedTargetLines(
  selectedTarget: Extract<CurrentBranchState, { kind: "requestFailed" }>["selectedTarget"]
): string[] {
  if (!selectedTarget) {
    return [];
  }

  const lines = [
    selectedTarget.kind === "pullRequest" ? "Target: Pull request job" : "Target: Branch job"
  ];
  if (selectedTarget.kind === "pullRequest" && selectedTarget.pullRequest) {
    const summary = formatPullRequestSummary(selectedTarget.pullRequest);
    if (summary) {
      lines.push(summary);
    }
  }
  lines.push(`Job: ${selectedTarget.jobName}`);
  return lines;
}

function formatPullRequestLabel(
  pullRequest: CurrentBranchPullRequestInfo | undefined
): string | undefined {
  return pullRequest ? `PR #${pullRequest.number}` : undefined;
}
