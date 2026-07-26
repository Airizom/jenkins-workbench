import type { NodeStatusClass } from "../../../nodeDetails/shared/NodeDetailsContracts";
import { cn } from "./utils";

type BuildResultClassKey = "success" | "failure" | "unstable" | "aborted" | "running" | "neutral";
type BuildResultStyle = {
  badge: string;
  text: string;
  iconText: string;
  accent: string;
  stageNode: string;
  connectorColor: string;
  graphBackground: string;
  borderColor: string;
};
type NodeStatusStyle = { badge: string; icon: string; accent: string };

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

const WARNING_BUILD_RESULT_STYLE: Omit<BuildResultStyle, "stageNode"> = {
  badge: "border-warning-border bg-warning-soft text-warning-foreground",
  text: "text-warning-foreground",
  iconText: "text-warning",
  accent: "bg-warning",
  connectorColor: "var(--warning)",
  graphBackground:
    "linear-gradient(180deg, color-mix(in srgb, var(--warning-soft) 65%, var(--card)), var(--card))",
  borderColor: "var(--warning-border)"
};
const WARNING_STAGE_NODE_CLASS = "border-warning-border bg-warning-soft text-warning";

const BUILD_RESULT_STYLES: Record<BuildResultClassKey, BuildResultStyle> = {
  success: {
    badge: "border-success-border bg-success-soft text-success-foreground",
    text: "text-success-foreground",
    iconText: "text-success",
    accent: "bg-success",
    stageNode: "border-success-border bg-success-soft text-success",
    connectorColor: "var(--success)",
    graphBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--success-soft) 60%, var(--card)), var(--card))",
    borderColor: "var(--success-border)"
  },
  failure: {
    badge: "border-failure-border bg-failure-soft text-failure-foreground",
    text: "text-failure-foreground",
    iconText: "text-failure",
    accent: "bg-failure",
    stageNode: "border-failure-border bg-failure-soft text-failure",
    connectorColor: "var(--failure)",
    graphBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--failure-soft) 75%, var(--card)), var(--card))",
    borderColor: "var(--failure-border)"
  },
  unstable: {
    ...WARNING_BUILD_RESULT_STYLE,
    stageNode: WARNING_STAGE_NODE_CLASS
  },
  aborted: {
    badge: "border-aborted-border bg-aborted-soft text-aborted-foreground",
    text: "text-aborted-foreground",
    iconText: "text-aborted",
    accent: "bg-aborted",
    stageNode: "border-aborted-border bg-aborted-soft text-aborted",
    connectorColor: "var(--aborted)",
    graphBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--aborted-soft) 70%, var(--card)), var(--card))",
    borderColor: "var(--aborted-border)"
  },
  running: {
    ...WARNING_BUILD_RESULT_STYLE,
    stageNode: `${WARNING_STAGE_NODE_CLASS} animate-pulse`
  },
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    text: "text-foreground",
    iconText: "text-muted-foreground",
    accent: "bg-border",
    stageNode: "border-border bg-muted text-muted-foreground",
    connectorColor: "var(--border)",
    graphBackground:
      "linear-gradient(180deg, color-mix(in srgb, var(--muted-soft) 60%, var(--card)), var(--card))",
    borderColor: "var(--border)"
  }
};

const WARNING_NODE_STATUS_STYLE: NodeStatusStyle = {
  badge: "border-warning-border text-warning bg-warning-soft",
  icon: "text-warning",
  accent: "bg-warning"
};

const NODE_STATUS_STYLES: Record<NodeStatusClass, NodeStatusStyle> = {
  online: {
    badge: "border-success-border text-success bg-success-soft",
    icon: "text-success",
    accent: "bg-success"
  },
  idle: WARNING_NODE_STATUS_STYLE,
  temporary: WARNING_NODE_STATUS_STYLE,
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
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].badge;
}
export function resolveResultTextClass(resultClass?: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].text;
}
export function resolveStatusAccentClass(resultClass: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].accent;
}
export function resolveResultIconTextClass(resultClass?: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].iconText;
}

const STAGE_NODE_BASE_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors";
export function resolveBuildResultStageNodeClass(resultClass?: string): string {
  return cn(
    STAGE_NODE_BASE_CLASS,
    BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].stageNode
  );
}
export function resolveBuildResultConnectorColor(resultClass?: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].connectorColor;
}
export function resolveBuildResultGraphBackground(resultClass?: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].graphBackground;
}
export function resolveBuildResultBorderColor(resultClass?: string): string {
  return BUILD_RESULT_STYLES[normalizeBuildResultClass(resultClass)].borderColor;
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
      return resolveResultBadgeClass("neutral");
  }
}
