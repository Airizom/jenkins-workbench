import {
  type DiagnosticRunState,
  type EnvironmentDiagnosticsReport,
  type RecoveryAction,
  recoveryActionLabels
} from "../../../environmentDiagnostics/EnvironmentDiagnosticsContracts";

export interface EnvironmentDiagnosticsViewModel {
  revision: number;
  environmentLabel: string;
  url: string;
  scope: "workspace" | "global";
  state: DiagnosticRunState;
  recovering: boolean;
  report?: EnvironmentDiagnosticsReport;
  notice?: string;
}

export type EnvironmentDiagnosticsIncomingMessage =
  | { type: "environmentDiagnosticsReady" | "run" | "cancel" | "copyReport" }
  | { type: "recover"; action: RecoveryAction };

export interface EnvironmentDiagnosticsOutgoingMessage {
  type: "updateEnvironmentDiagnostics";
  model: EnvironmentDiagnosticsViewModel;
}

export function isRecoveryAction(value: unknown): value is RecoveryAction {
  return typeof value === "string" && Object.hasOwn(recoveryActionLabels, value);
}

export function parseEnvironmentDiagnosticsIncomingMessage(
  value: unknown
): EnvironmentDiagnosticsIncomingMessage | undefined {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") {
    return undefined;
  }
  if (["environmentDiagnosticsReady", "run", "cancel", "copyReport"].includes(value.type)) {
    return { type: value.type as "environmentDiagnosticsReady" | "run" | "cancel" | "copyReport" };
  }
  if (value.type === "recover" && "action" in value && isRecoveryAction(value.action)) {
    return { type: "recover", action: value.action };
  }
  return undefined;
}

export function parseEnvironmentDiagnosticsOutgoingMessage(
  value: unknown
): EnvironmentDiagnosticsOutgoingMessage | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== "updateEnvironmentDiagnostics" ||
    !("model" in value) ||
    !value.model ||
    typeof value.model !== "object"
  ) {
    return undefined;
  }
  const model = value.model as Partial<EnvironmentDiagnosticsViewModel>;
  return typeof model.revision === "number" &&
    Number.isSafeInteger(model.revision) &&
    typeof model.environmentLabel === "string" &&
    typeof model.url === "string" &&
    (model.scope === "workspace" || model.scope === "global") &&
    ["idle", "running", "completed", "cancelled", "removed"].includes(model.state ?? "") &&
    typeof model.recovering === "boolean" &&
    (model.report === undefined || Array.isArray(model.report.checks))
    ? (value as EnvironmentDiagnosticsOutgoingMessage)
    : undefined;
}
