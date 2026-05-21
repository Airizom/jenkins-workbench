export function resolveResultBadgeClass(resultClass: string): string {
  switch (resultClass) {
    case "success":
      return "border-success-border bg-success-soft text-success-foreground";
    case "failure":
      return "border-failure-border bg-failure-soft text-failure-foreground";
    case "unstable":
      return "border-warning-border bg-warning-soft text-warning-foreground";
    case "aborted":
      return "border-aborted-border bg-aborted-soft text-aborted-foreground";
    case "running":
      return "border-inputInfoBorder bg-inputInfoBg text-inputInfoFg";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function resolveResultTextClass(resultClass?: string): string {
  switch (resultClass) {
    case "success":
      return "text-success-foreground";
    case "failure":
      return "text-failure-foreground";
    case "unstable":
      return "text-warning-foreground";
    case "aborted":
      return "text-aborted-foreground";
    case "running":
      return "text-inputInfoFg";
    default:
      return "text-foreground";
  }
}

export function resolveStatusAccentClass(resultClass: string): string {
  switch (resultClass) {
    case "success":
      return "bg-success";
    case "failure":
      return "bg-failure";
    case "unstable":
      return "bg-warning";
    case "aborted":
      return "bg-aborted";
    case "running":
      return "bg-warning";
    default:
      return "bg-border";
  }
}

export function resolveSeverityBadgeClass(severity: "critical" | "warning" | "normal"): string {
  switch (severity) {
    case "critical":
      return "border-failure-border bg-failure-soft text-failure-foreground";
    case "warning":
      return "border-warning-border bg-warning-soft text-warning-foreground";
    default:
      return "border-success-border bg-success-soft text-success-foreground";
  }
}
