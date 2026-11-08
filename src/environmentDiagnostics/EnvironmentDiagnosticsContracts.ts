export type DiagnosticCheckId =
  | "connectivity"
  | "authentication"
  | "api"
  | "queue"
  | "nodes"
  | "csrf"
  | "pipeline";

export type DiagnosticStatus = "passed" | "warning" | "failed" | "unavailable" | "skipped";
export type RecoveryAction =
  | "retry"
  | "editUrl"
  | "editCredentials"
  | "signIn"
  | "tlsSettings"
  | "timeoutSettings"
  | "openJenkins";
export type DiagnosticRunState = "idle" | "running" | "completed" | "cancelled" | "removed";

export interface DiagnosticCheck {
  id: DiagnosticCheckId;
  label: string;
  status: DiagnosticStatus;
  code: string;
  summary: string;
  detail: string;
  actions: RecoveryAction[];
  evidence?: string[];
}

export interface EnvironmentDiagnosticsReport {
  runId: number;
  startedAt: string;
  completedAt?: string;
  checks: DiagnosticCheck[];
  jenkinsVersion?: string;
}

export const recoveryActionLabels: Record<RecoveryAction, string> = {
  retry: "Retry",
  editUrl: "Edit URL",
  editCredentials: "Edit Credentials",
  signIn: "Sign In with Browser SSO",
  tlsSettings: "TLS Settings",
  timeoutSettings: "Request Timeout Settings",
  openJenkins: "Open Jenkins"
};
