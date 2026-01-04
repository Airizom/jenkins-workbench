export function formatCompletionStatus(
  result?: unknown,
  color?: unknown
): { label: string; severity: "info" | "warning" } {
  const normalizedResult = typeof result === "string" ? result.toUpperCase() : undefined;

  if (normalizedResult) {
    switch (normalizedResult) {
      case "SUCCESS":
        return { label: "Success", severity: "info" };
      case "FAILURE":
        return { label: "Failure", severity: "warning" };
      case "UNSTABLE":
        return { label: "Unstable", severity: "warning" };
      case "ABORTED":
        return { label: "Aborted", severity: "warning" };
      case "NOT_BUILT":
        return { label: "Not built", severity: "info" };
      default:
        break;
    }
  }

  const normalizedColor =
    typeof color === "string" ? color.toLowerCase().replace(/_anime$/, "") : undefined;

  if (normalizedColor) {
    switch (normalizedColor) {
      case "blue":
      case "green":
        return { label: "Success", severity: "info" };
      case "red":
        return { label: "Failure", severity: "warning" };
      case "yellow":
        return { label: "Unstable", severity: "warning" };
      case "aborted":
        return { label: "Aborted", severity: "warning" };
      case "notbuilt":
        return { label: "Not built", severity: "info" };
      case "disabled":
      case "grey":
        return { label: "Disabled", severity: "info" };
      default:
        break;
    }
  }

  return { label: "Unknown", severity: "info" };
}
