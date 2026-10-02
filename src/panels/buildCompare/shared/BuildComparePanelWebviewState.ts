import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import type { SerializedEnvironmentState } from "../../shared/webview/WebviewPanelState";
import {
  createEnvironmentScopedPanelState,
  isNonEmptyString,
  validateEnvironmentScopedPanelState
} from "../../shared/webview/WebviewPanelState";

const BUILD_COMPARE_SECTION_IDS = [
  "tests",
  "parameters",
  "changesets",
  "stages",
  "console"
] as const;

export type BuildCompareSectionId = (typeof BUILD_COMPARE_SECTION_IDS)[number];

/**
 * Webview-owned UI state persisted alongside the build pair. Sections the user
 * toggled away from their default (open, or collapsed when nothing changed) are
 * recorded explicitly.
 */
export interface BuildComparePanelUiState {
  collapsedSections?: BuildCompareSectionId[];
  expandedSections?: BuildCompareSectionId[];
}

export interface BuildComparePanelSerializedState extends SerializedEnvironmentState {
  baselineBuildUrl: string;
  targetBuildUrl: string;
  /**
   * Best-effort UI state written by the webview, possibly by an older version.
   * Read it through normalizeBuildComparePanelUiState.
   */
  compareUi?: unknown;
}

export function createBuildComparePanelState(
  environment: JenkinsEnvironmentRef,
  baselineBuildUrl: string,
  targetBuildUrl: string
): BuildComparePanelSerializedState {
  return createEnvironmentScopedPanelState(environment, {
    baselineBuildUrl,
    targetBuildUrl
  });
}

export function isBuildComparePanelState(
  value: unknown
): value is BuildComparePanelSerializedState {
  return validateEnvironmentScopedPanelState(
    value,
    (record) =>
      isNonEmptyString(record.baselineBuildUrl) &&
      isNonEmptyString(record.targetBuildUrl) &&
      (typeof record.compareUi === "undefined" || isPlainRecord(record.compareUi))
  );
}

export function updateBuildComparePanelState(
  state: BuildComparePanelSerializedState,
  baselineBuildUrl: string,
  targetBuildUrl: string
): BuildComparePanelSerializedState {
  return {
    ...state,
    baselineBuildUrl,
    targetBuildUrl
  };
}

function isBuildCompareSectionId(value: unknown): value is BuildCompareSectionId {
  return BUILD_COMPARE_SECTION_IDS.includes(value as BuildCompareSectionId);
}

function normalizeSectionIds(value: unknown): BuildCompareSectionId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isBuildCompareSectionId))] : [];
}

export function normalizeBuildComparePanelUiState(value: unknown): BuildComparePanelUiState {
  if (!isPlainRecord(value)) {
    return {};
  }
  const collapsedSections = normalizeSectionIds(value.collapsedSections);
  // A section is either explicitly collapsed or explicitly expanded, never both.
  const expandedSections = normalizeSectionIds(value.expandedSections).filter(
    (id) => !collapsedSections.includes(id)
  );
  return {
    ...(collapsedSections.length > 0 ? { collapsedSections } : {}),
    ...(expandedSections.length > 0 ? { expandedSections } : {})
  };
}
