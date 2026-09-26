import type { JenkinsBuild } from "../jenkins/types";
import type { CurrentBranchState } from "./CurrentBranchTypes";

type Matched = Extract<CurrentBranchState, { kind: "matched" }>;

export function commitResultLabel(build: Pick<JenkinsBuild, "building" | "result">): string {
  if (build.building) return "building";
  switch (build.result?.toUpperCase()) {
    case "SUCCESS":
      return "passed";
    case "FAILURE":
      return "failed";
    case "UNSTABLE":
      return "unstable";
    case "ABORTED":
      return "aborted";
    case "NOT_BUILT":
      return "not built";
    default:
      return build.result?.toLowerCase() ?? "status unknown";
  }
}

export function currentCommitLabel(state: Matched): string {
  const { commit, checkout } = state;
  if (!checkout || !commit) return "Checking current commit";
  const current = commit.current;
  let label = current
    ? `${checkout.head?.slice(0, 7)} ${commitResultLabel(current.build)}${current.evidence.kind === "prMerge" ? " via PR merge" : ""} · #${current.build.number}`
    : commit.kind === "unverified"
      ? `Build ${commitResultLabel(state.lastBuild ?? {})} · revision unverified`
      : `${checkout.head?.slice(0, 7) ?? "HEAD"} · no verified build`;
  if (checkout.dirty) label += " · local changes untested";
  if (checkout.ahead && checkout.ahead > 0)
    label += ` · ${checkout.ahead} commit${checkout.ahead === 1 ? "" : "s"} ahead of upstream`;
  return label;
}

export function currentCommitTooltip(state: Matched): string[] {
  const { checkout, commit, history } = state;
  if (!checkout || !commit) return ["Checking current commit; previous verification cleared"];
  const lines = [currentCommitLabel(state), `HEAD: ${checkout.head ?? "unknown"}`, commit.reason];
  if (commit.kind !== "verified")
    lines.push("No verified build for current commit in the newest 50 builds");
  lines.push("Search scope: newest 50 builds of the selected Jenkins job");
  if (commit.current) {
    const evidence = commit.current.evidence;
    lines.push(`Evidence: ${evidence.source}`, `Repository identity: ${evidence.repository}`);
    if (evidence.checkoutRevision) lines.push(`Tested checkout: ${evidence.checkoutRevision}`);
  }
  if (commit.lastPass) {
    const { build, assessment } = commit.lastPass;
    lines.push(
      `Last pass: #${build.number} · ${assessment.kind === "verified" ? assessment.evidence.revision : "revision unverified"}`
    );
  }
  if (history?.lastPassError) lines.push(history.lastPassError);
  if (history?.job.inQueue) lines.push("Job queued · commit not yet verified");
  lines.push(
    checkout.upstream && typeof checkout.ahead === "number" && typeof checkout.behind === "number"
      ? `Local upstream snapshot: ${checkout.upstream} · ${checkout.ahead} ahead, ${checkout.behind} behind; no fetch performed`
      : "Push status unknown: upstream counts unavailable"
  );
  return lines;
}
