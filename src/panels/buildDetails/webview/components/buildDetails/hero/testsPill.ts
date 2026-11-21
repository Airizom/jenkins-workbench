import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { describeTestOutcome } from "../testResults/testResultsUtils";

const TESTS_PILL_TONE_CLASSES = {
  failed: "border-failure-border bg-failure-soft text-failure",
  passed: "border-success-border bg-success-soft text-success",
  skipped: "border-warning-border bg-warning-soft text-warning"
} as const;

export function describeTestsPill(
  summary: BuildTestsSummaryViewModel
): { label: string; className: string } | undefined {
  if (!summary.hasAnyResults || summary.totalCount === 0) {
    return undefined;
  }
  const outcome = describeTestOutcome(summary);
  return { label: outcome.countsLabel, className: TESTS_PILL_TONE_CLASSES[outcome.tone] };
}
