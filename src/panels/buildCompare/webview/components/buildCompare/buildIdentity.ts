import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";

/** The job name both builds share, or undefined when they come from different jobs. */
export function resolveSharedJobName(
  baseline: BuildCompareBuildViewModel,
  target: BuildCompareBuildViewModel
): string | undefined {
  return baseline.jobDisplayName && baseline.jobDisplayName === target.jobDisplayName
    ? baseline.jobDisplayName
    : undefined;
}

export function haveDifferentJobs(
  baseline: BuildCompareBuildViewModel,
  target: BuildCompareBuildViewModel
): boolean {
  return (
    !!(baseline.jobDisplayName || target.jobDisplayName) &&
    baseline.jobDisplayName !== target.jobDisplayName
  );
}
