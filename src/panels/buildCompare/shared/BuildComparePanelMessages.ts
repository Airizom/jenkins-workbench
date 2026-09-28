import { asRecord, hasMessageType, isPlainRecord } from "../../../shared/runtimeGuards";
import {
  type BuildCompareConsoleSectionViewModel,
  type BuildCompareViewModel,
  type CompareSectionStatus,
  compareSectionStatuses
} from "./BuildCompareContracts";
import {
  type BuildComparePanelSerializedState,
  isBuildComparePanelState
} from "./BuildComparePanelWebviewState";

export interface SwapBuildsMessage {
  type: "swapBuilds";
}

/** Posted by the webview after mount so the host can re-send pending sections. */
export interface BuildCompareReadyMessage {
  type: "buildCompareReady";
}

/** Posted by the webview to re-run the comparison load, e.g. after errors. */
export interface RefreshBuildCompareMessage {
  type: "refreshBuildCompare";
}

export interface OpenBuildDetailsMessage {
  type: "openBuildDetails";
  side: "baseline" | "target";
}

export interface UpdateConsoleSectionMessage {
  type: "updateConsoleSection";
  console: BuildCompareConsoleSectionViewModel;
}

/**
 * Replaces the rendered comparison after a refresh or swap without reloading
 * the webview, so scroll position, collapsed sections, and toasts survive.
 */
export interface UpdateBuildCompareMessage {
  type: "updateBuildCompare";
  model: BuildCompareViewModel;
  panelState: BuildComparePanelSerializedState;
}

/** A refresh or swap failed; the webview keeps the last good comparison. */
export interface BuildCompareRefreshFailedMessage {
  type: "buildCompareRefreshFailed";
  message: string;
}

export type BuildCompareOutgoingMessage =
  | UpdateConsoleSectionMessage
  | UpdateBuildCompareMessage
  | BuildCompareRefreshFailedMessage;
export type BuildCompareIncomingMessage =
  | SwapBuildsMessage
  | OpenBuildDetailsMessage
  | BuildCompareReadyMessage
  | RefreshBuildCompareMessage;

export function parseBuildCompareOutgoingMessage(
  message: unknown
): BuildCompareOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  switch (record.type) {
    case "updateConsoleSection":
      return isBuildCompareConsoleSectionViewModel(record.console)
        ? { type: "updateConsoleSection", console: record.console }
        : undefined;
    case "updateBuildCompare":
      return isBuildCompareViewModelShape(record.model) &&
        isBuildComparePanelState(record.panelState)
        ? { type: "updateBuildCompare", model: record.model, panelState: record.panelState }
        : undefined;
    case "buildCompareRefreshFailed":
      return typeof record.message === "string"
        ? { type: "buildCompareRefreshFailed", message: record.message }
        : undefined;
    default:
      return undefined;
  }
}

const LIST_FIELDS_BY_SECTION = {
  tests: [
    "newFailures",
    "stillFailing",
    "newPasses",
    "addedTests",
    "removedTests",
    "otherChanges",
    "ambiguousTests"
  ],
  parameters: ["items"],
  changesets: ["baselineItems", "targetItems"],
  stages: ["items"]
} as const;

/**
 * Structural check for host-produced view models: validates the fields the
 * webview dereferences unconditionally, not every leaf value.
 */
function isBuildCompareViewModelShape(value: unknown): value is BuildCompareViewModel {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (!isBuildShape(value.baseline) || !isBuildShape(value.target)) {
    return false;
  }
  if (!Array.isArray(value.errors) || !value.errors.every((error) => typeof error === "string")) {
    return false;
  }
  for (const [sectionKey, listFields] of Object.entries(LIST_FIELDS_BY_SECTION)) {
    const section = value[sectionKey];
    if (!isSectionBaseShape(section)) {
      return false;
    }
    if (!listFields.every((field) => Array.isArray(section[field]))) {
      return false;
    }
  }
  return isBuildCompareConsoleSectionViewModel(value.console);
}

function isBuildShape(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.displayName === "string" &&
    typeof value.buildNumberLabel === "string" &&
    typeof value.buildUrl === "string"
  );
}

function isSectionBaseShape(value: unknown): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    compareSectionStatuses.includes(value.status as CompareSectionStatus) &&
    typeof value.summaryLabel === "string"
  );
}

function isBuildCompareConsoleSectionViewModel(
  value: unknown
): value is BuildCompareConsoleSectionViewModel {
  const record = asRecord(value);
  return (
    !!record &&
    !Array.isArray(record) &&
    compareSectionStatuses.includes(record.status as CompareSectionStatus) &&
    typeof record.summaryLabel === "string" &&
    isOptionalString(record.detail) &&
    isOptionalString(record.divergenceLineLabel) &&
    isConsoleSnippetLines(record.baselineLines) &&
    isConsoleSnippetLines(record.targetLines)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isConsoleSnippetLines(value: unknown): boolean {
  return Array.isArray(value) && value.every(isConsoleSnippetLine);
}

function isConsoleSnippetLine(value: unknown): boolean {
  const record = asRecord(value);
  return (
    !!record &&
    !Array.isArray(record) &&
    typeof record.lineNumber === "number" &&
    typeof record.text === "string" &&
    typeof record.highlight === "boolean"
  );
}

export function isSwapBuildsMessage(message: unknown): message is SwapBuildsMessage {
  return hasMessageType(message, "swapBuilds");
}

export function isBuildCompareReadyMessage(message: unknown): message is BuildCompareReadyMessage {
  return hasMessageType(message, "buildCompareReady");
}

export function isRefreshBuildCompareMessage(
  message: unknown
): message is RefreshBuildCompareMessage {
  return hasMessageType(message, "refreshBuildCompare");
}

export function isOpenBuildDetailsMessage(message: unknown): message is OpenBuildDetailsMessage {
  return (
    hasMessageType(message, "openBuildDetails") &&
    (message.side === "baseline" || message.side === "target")
  );
}
