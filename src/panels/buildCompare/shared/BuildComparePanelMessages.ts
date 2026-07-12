import { asRecord, hasMessageType } from "../../../shared/runtimeGuards";
import type {
  BuildCompareConsoleSectionViewModel,
  CompareSectionStatus
} from "./BuildCompareContracts";

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

export type BuildCompareOutgoingMessage = UpdateConsoleSectionMessage;
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

  if (record.type !== "updateConsoleSection") {
    return undefined;
  }

  if (!isBuildCompareConsoleSectionViewModel(record.console)) {
    return undefined;
  }

  return {
    type: "updateConsoleSection",
    console: record.console
  };
}

const compareSectionStatuses = new Set<CompareSectionStatus>([
  "loading",
  "available",
  "empty",
  "unavailable",
  "error",
  "tooLarge",
  "identical"
]);

function isBuildCompareConsoleSectionViewModel(
  value: unknown
): value is BuildCompareConsoleSectionViewModel {
  const record = asRecord(value);
  return (
    !!record &&
    !Array.isArray(record) &&
    compareSectionStatuses.has(record.status as CompareSectionStatus) &&
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
