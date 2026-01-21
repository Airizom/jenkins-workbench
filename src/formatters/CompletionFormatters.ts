type CompletionSeverity = "info" | "warning";
type CompletionStatus = { label: string; severity: CompletionSeverity };

const COMPLETION_STATUSES = {
  success: { label: "Success", severity: "info" },
  failure: { label: "Failure", severity: "warning" },
  unstable: { label: "Unstable", severity: "warning" },
  aborted: { label: "Aborted", severity: "warning" },
  notBuilt: { label: "Not built", severity: "info" },
  disabled: { label: "Disabled", severity: "info" },
  unknown: { label: "Unknown", severity: "info" }
} as const;

const RESULT_STATUS_MAP: Record<string, CompletionStatus> = {
  SUCCESS: COMPLETION_STATUSES.success,
  FAILURE: COMPLETION_STATUSES.failure,
  UNSTABLE: COMPLETION_STATUSES.unstable,
  ABORTED: COMPLETION_STATUSES.aborted,
  NOT_BUILT: COMPLETION_STATUSES.notBuilt
};

const COLOR_STATUS_MAP: Record<string, CompletionStatus> = {
  blue: COMPLETION_STATUSES.success,
  green: COMPLETION_STATUSES.success,
  red: COMPLETION_STATUSES.failure,
  yellow: COMPLETION_STATUSES.unstable,
  aborted: COMPLETION_STATUSES.aborted,
  notbuilt: COMPLETION_STATUSES.notBuilt,
  disabled: COMPLETION_STATUSES.disabled,
  grey: COMPLETION_STATUSES.disabled
};

const normalizeResult = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.toUpperCase();
};

const normalizeColor = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.toLowerCase().replace(/_anime$/, "");
};

export function formatCompletionStatus(
  result?: unknown,
  color?: unknown
): { label: string; severity: CompletionSeverity } {
  const normalizedResult = normalizeResult(result);
  if (normalizedResult) {
    const status = RESULT_STATUS_MAP[normalizedResult];
    if (status) {
      return status;
    }
  }

  const normalizedColor = normalizeColor(color);
  if (normalizedColor) {
    return COLOR_STATUS_MAP[normalizedColor] ?? COMPLETION_STATUSES.unknown;
  }

  return COMPLETION_STATUSES.unknown;
}
