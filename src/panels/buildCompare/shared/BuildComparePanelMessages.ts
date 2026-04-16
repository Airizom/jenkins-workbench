import type { BuildCompareConsoleSectionViewModel } from "./BuildCompareContracts";

export interface SwapBuildsMessage {
  type: "swapBuilds";
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
export type BuildCompareIncomingMessage = SwapBuildsMessage | OpenBuildDetailsMessage;

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

  return {
    type: "updateConsoleSection",
    console: (record.console ?? {}) as BuildCompareConsoleSectionViewModel
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function isSwapBuildsMessage(message: unknown): message is SwapBuildsMessage {
  return isRecord(message) && message.type === "swapBuilds";
}

export function isOpenBuildDetailsMessage(message: unknown): message is OpenBuildDetailsMessage {
  return (
    isRecord(message) &&
    message.type === "openBuildDetails" &&
    (message.side === "baseline" || message.side === "target")
  );
}
