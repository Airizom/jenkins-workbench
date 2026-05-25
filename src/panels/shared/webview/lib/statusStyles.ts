import type { NodeStatusClass } from "../../../nodeDetails/shared/NodeDetailsContracts";
import { cn } from "./utils";

type BuildResultClassKey = "success" | "failure" | "unstable" | "aborted" | "running" | "neutral";

function normalizeBuildResultClass(resultClass?: string): BuildResultClassKey {
  switch (resultClass) {
    case "success":
    case "failure":
    case "unstable":
    case "aborted":
    case "running":
      return resultClass;
    default:
      return "neutral";
  }
}

const BUILD_RESULT_BADGE_CLASSES: Record<BuildResultClassKey, string> = {
  success: "border-success-border bg-success-soft text-success-foreground",
  failure: "border-failure-border bg-failure-soft text-failure-foreground",
  unstable: "border-warning-border bg-warning-soft text-warning-foreground",
  aborted: "border-aborted-border bg-aborted-soft text-aborted-foreground",
  running: "border-inputInfoBorder bg-inputInfoBg text-inputInfoFg",
  neutral: "border-border bg-muted text-muted-foreground"
};

const BUILD_RESULT_TEXT_CLASSES: Record<BuildResultClassKey, string> = {
  success: "text-success-foreground",
  failure: "text-failure-foreground",
  unstable: "text-warning-foreground",
  aborted: "text-aborted-foreground",
  running: "text-inputInfoFg",
  neutral: "text-foreground"
};

const BUILD_RESULT_ACCENT_CLASSES: Record<BuildResultClassKey, string> = {
  success: "bg-success",
  failure: "bg-failure",
  unstable: "bg-warning",
  aborted: "bg-aborted",
  running: "bg-warning",
  neutral: "bg-border"
};

const BUILD_RESULT_STAGE_NODE_CLASSES: Record<BuildResultClassKey, string> = {
  success: "border-success-border bg-success-soft text-success",
  failure: "border-failure-border bg-failure-soft text-failure",
  unstable: "border-warning-border bg-warning-soft text-warning",
  aborted: "border-aborted-border bg-aborted-soft text-aborted",
  running: "border-warning-border bg-warning-soft text-warning animate-pulse",
  neutral: "border-border bg-muted text-muted-foreground"
};

const BUILD_RESULT_CONNECTOR_COLORS: Record<BuildResultClassKey, string> = {
  success: "var(--success)",
  failure: "var(--failure)",
  unstable: "var(--warning)",
  aborted: "var(--aborted)",
  running: "var(--warning)",
  neutral: "var(--border)"
};

const BUILD_RESULT_GRAPH_BACKGROUNDS: Record<BuildResultClassKey, string> = {
  success:
    "linear-gradient(180deg, color-mix(in srgb, var(--success-soft) 60%, var(--card)), var(--card))",
  failure:
    "linear-gradient(180deg, color-mix(in srgb, var(--failure-soft) 75%, var(--card)), var(--card))",
  unstable:
    "linear-gradient(180deg, color-mix(in srgb, var(--warning-soft) 65%, var(--card)), var(--card))",
  aborted:
    "linear-gradient(180deg, color-mix(in srgb, var(--aborted-soft) 70%, var(--card)), var(--card))",
  running:
    "linear-gradient(180deg, color-mix(in srgb, var(--warning-soft) 65%, var(--card)), var(--card))",
  neutral:
    "linear-gradient(180deg, color-mix(in srgb, var(--muted-soft) 60%, var(--card)), var(--card))"
};

const BUILD_RESULT_BORDER_COLORS: Record<BuildResultClassKey, string> = {
  success: "var(--success-border)",
  failure: "var(--failure-border)",
  unstable: "var(--warning-border)",
  aborted: "var(--aborted-border)",
  running: "var(--warning-border)",
  neutral: "var(--border)"
};

const NODE_STATUS_STYLES: Record<NodeStatusClass, { badge: string; icon: string; accent: string }> =
  {
    online: {
      badge: "border-success-border text-success bg-success-soft",
      icon: "text-success",
      accent: "bg-success"
    },
    idle: {
      badge: "border-warning-border text-warning bg-warning-soft",
      icon: "text-warning",
      accent: "bg-warning"
    },
    temporary: {
      badge: "border-warning-border text-warning bg-warning-soft",
      icon: "text-warning",
      accent: "bg-warning"
    },
    offline: {
      badge: "border-failure-border text-failure bg-failure-soft",
      icon: "text-failure",
      accent: "bg-failure"
    },
    unknown: {
      badge: "border-border text-foreground bg-muted",
      icon: "text-muted-foreground",
      accent: "bg-border"
    }
  };

export function resolveResultBadgeClass(resultClass: string): string {
  return BUILD_RESULT_BADGE_CLASSES[normalizeBuildResultClass(resultClass)];
}

export function resolveResultTextClass(resultClass?: string): string {
  return BUILD_RESULT_TEXT_CLASSES[normalizeBuildResultClass(resultClass)];
}

export function resolveStatusAccentClass(resultClass: string): string {
  return BUILD_RESULT_ACCENT_CLASSES[normalizeBuildResultClass(resultClass)];
}

const STAGE_NODE_BASE_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors";

export function resolveBuildResultStageNodeClass(resultClass?: string): string {
  return cn(
    STAGE_NODE_BASE_CLASS,
    BUILD_RESULT_STAGE_NODE_CLASSES[normalizeBuildResultClass(resultClass)]
  );
}

export function resolveBuildResultConnectorColor(resultClass?: string): string {
  return BUILD_RESULT_CONNECTOR_COLORS[normalizeBuildResultClass(resultClass)];
}

export function resolveBuildResultGraphBackground(resultClass?: string): string {
  return BUILD_RESULT_GRAPH_BACKGROUNDS[normalizeBuildResultClass(resultClass)];
}

export function resolveBuildResultBorderColor(resultClass?: string): string {
  return BUILD_RESULT_BORDER_COLORS[normalizeBuildResultClass(resultClass)];
}

export function resolveNodeStatusBadgeClass(statusClass: NodeStatusClass): string {
  return NODE_STATUS_STYLES[statusClass].badge;
}

export function resolveNodeStatusIconClass(statusClass: NodeStatusClass): string {
  return NODE_STATUS_STYLES[statusClass].icon;
}

export function resolveNodeStatusAccentClass(statusClass: NodeStatusClass): string {
  return NODE_STATUS_STYLES[statusClass].accent;
}

export function isAnalysisBuildResult(resultClass: string): boolean {
  return resultClass === "failure" || resultClass === "unstable";
}

export function resolveSeverityBadgeClass(severity: "critical" | "warning" | "normal"): string {
  switch (severity) {
    case "critical":
      return resolveResultBadgeClass("failure");
    case "warning":
      return resolveResultBadgeClass("unstable");
    default:
      return resolveResultBadgeClass("success");
  }
}
