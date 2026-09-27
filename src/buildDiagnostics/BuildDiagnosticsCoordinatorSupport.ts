import type * as vscode from "vscode";
import type {
  CurrentBranchRepositoryInfo,
  CurrentBranchState
} from "../currentBranch/CurrentBranchTypes";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { getUnambiguousCheckoutRevision } from "../jenkins/JenkinsRevisionEvidence";
import type { JenkinsBuildDetails } from "../jenkins/types";
import { normalizeJenkinsUrlForComparison } from "../jenkins/urls";
import type { BuildDiagnosticsViewModel } from "../panels/buildDetails/shared/BuildDetailsContracts";
import type { BuildDiagnosticScanSnapshot } from "./BuildDiagnosticScanner";

export interface BuildDiagnosticOwner {
  kind: "panel" | "currentBranch";
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  preferredRepositoryUri?: string;
  building?: boolean;
  result?: string;
  pendingDetails?: JenkinsBuildDetails;
  checkoutWarning?: string;
}

export function takePendingOwnerDetails(
  owner: BuildDiagnosticOwner
): JenkinsBuildDetails | undefined {
  if (owner.kind !== "panel") {
    return undefined;
  }
  const details = owner.pendingDetails;
  if (details) {
    owner.pendingDetails = undefined;
  }
  return details;
}

export function formatScanSummary(
  scan: BuildDiagnosticScanSnapshot,
  viewModel: BuildDiagnosticsViewModel,
  buildIdentity: string
): string {
  const fallback = scan.fallbackUsed ? "; bounded console fallback used" : "";
  const truncated = scan.truncated ? "; truncated" : "";
  return `Scanned ${scan.bytesRead} byte(s) for ${buildIdentity}; ${viewModel.resolvedCount} resolved, ${viewModel.unresolvedCount} unresolved${fallback}${truncated}.`;
}

export function toCurrentBranchOwner(state: CurrentBranchState): BuildDiagnosticOwner | undefined {
  if (state.kind !== "matched" || !state.commit?.current?.build.url) {
    return undefined;
  }
  return {
    kind: "currentBranch",
    environment: state.environment,
    buildUrl: state.commit.current.build.url,
    preferredRepositoryUri: state.repository.repositoryUriString,
    building: Boolean(state.commit.current.build.building),
    result: state.commit.current.build.result,
    checkoutWarning:
      state.commit.current.evidence.kind === "prMerge"
        ? "Jenkins tested a PR merge checkout; source locations may differ from local HEAD."
        : state.checkout?.dirty
          ? "Local changes are untested; source locations may differ from the tested checkout."
          : undefined
  };
}

export function shouldScanCurrentBranch(owner: BuildDiagnosticOwner): boolean {
  if (owner.building) {
    return true;
  }
  const result = owner.result?.trim().toUpperCase();
  return result === "FAILURE" || result === "FAILED" || result === "UNSTABLE";
}

export function ownerKey(owner: BuildDiagnosticOwner | undefined): string {
  return owner
    ? `${owner.kind}\0${owner.environment.scope}\0${owner.environment.environmentId}\0${normalizeJenkinsUrlForComparison(owner.buildUrl)}\0${owner.preferredRepositoryUri ?? ""}`
    : "";
}

function revisionsMatch(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 7 && normalizedRight.startsWith(normalizedLeft)) ||
    (normalizedRight.length >= 7 && normalizedLeft.startsWith(normalizedRight))
  );
}

export function buildScanKey(
  owner: BuildDiagnosticOwner,
  repositoryUri: vscode.Uri,
  profileFingerprint: string,
  maxLogBytes: number,
  maxProblems: number
): string {
  return `${owner.environment.scope}\0${owner.environment.environmentId}\0${owner.buildUrl}\0${repositoryUri.toString()}\0${profileFingerprint}\0${maxLogBytes}\0${maxProblems}`;
}

export function formatBuildIdentity(details: JenkinsBuildDetails, buildUrl: string): string {
  const displayName = details.fullDisplayName ?? details.displayName;
  if (displayName) {
    return `Jenkins ${displayName}`;
  }
  return `Jenkins build #${details.number ?? new URL(buildUrl).pathname.split("/").filter(Boolean).at(-1) ?? "?"}`;
}

function getUnambiguousJenkinsRevision(details: JenkinsBuildDetails): string | undefined {
  return getUnambiguousCheckoutRevision(details);
}

export function getCheckoutMismatchWarning(
  details: JenkinsBuildDetails,
  repository: CurrentBranchRepositoryInfo | undefined,
  localRevision: string | undefined
): string | undefined {
  if (!repository) {
    return undefined;
  }
  const remote = getUnambiguousJenkinsRevision(details);
  if (!localRevision || !remote || revisionsMatch(localRevision, remote)) {
    return undefined;
  }
  return `Checkout mismatch: Jenkins built ${remote}, while the local repository is at ${localRevision}.`;
}
