import type { JenkinsTestReportCase } from "../../jenkins/types";
import { firstNonEmpty, trimToUndefined } from "../../shared/stringValues";
import { formatTestDuration } from "./TestReportFormatters";
import {
  type NormalizedTestStatus,
  formatTestStatusLabel,
  normalizeTestStatus
} from "./TestStatusFormatters";

export interface NormalizedTestCaseBase {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  status: NormalizedTestStatus;
  statusLabel: string;
  durationLabel?: string;
}

export function buildTestCaseKey(
  className: string | undefined,
  suiteName: string | undefined,
  name: string
): string {
  return `${className ?? ""}::${suiteName ?? ""}::${name}`;
}

export function resolveTestCaseName(
  testCase: JenkinsTestReportCase,
  options?: { fallbackToClassName?: boolean; unnamedLabel?: string }
): string | undefined {
  const name = trimToUndefined(testCase.name);
  if (name) {
    return name;
  }
  if (options?.fallbackToClassName) {
    return firstNonEmpty(testCase.className, options.unnamedLabel ?? "Unnamed test");
  }
  return undefined;
}

export function normalizeTestCaseBase(
  testCase: JenkinsTestReportCase,
  suiteName: string | undefined,
  options?: { fallbackToClassName?: boolean; unnamedLabel?: string }
): NormalizedTestCaseBase | undefined {
  const name = resolveTestCaseName(testCase, options);
  if (!name) {
    return undefined;
  }
  const className = trimToUndefined(testCase.className);
  const status = normalizeTestStatus(testCase.status);
  return {
    key: buildTestCaseKey(className, suiteName, name),
    name,
    className,
    suiteName,
    status,
    statusLabel: formatTestStatusLabel(status),
    durationLabel: formatTestDuration(testCase.duration)
  };
}
