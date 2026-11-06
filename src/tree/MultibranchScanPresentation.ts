import * as vscode from "vscode";
import {
  formatMultibranchScanStatus,
  type MultibranchScanState
} from "../services/multibranchScan/MultibranchScanState";
import type { JenkinsFolderTreeItem } from "./items/TreeJobItems";

/** Derive presentation without mutating cached folder items or losing their branch filter. */
export function decorateMultibranchScanItem(
  item: JenkinsFolderTreeItem,
  state: MultibranchScanState
): vscode.TreeItem {
  const status = formatMultibranchScanStatus(state);
  const description = [item.description, status].filter(Boolean).join(" • ");
  const tooltip = [
    typeof item.tooltip === "string" ? item.tooltip : undefined,
    status,
    state.detail,
    state.logError ? `Log unavailable: ${state.logError}` : undefined,
    `Last checked: ${new Date(state.observedAt).toLocaleString()}`
  ]
    .filter(Boolean)
    .join("\n");
  const active =
    state.phase === "requested" || state.phase === "queued" || state.phase === "running";
  const warning =
    state.phase === "unavailable" || (state.phase === "completed" && state.outcome !== "success");
  return {
    ...item,
    description,
    tooltip,
    iconPath: active
      ? new vscode.ThemeIcon("sync~spin")
      : warning
        ? new vscode.ThemeIcon("warning")
        : item.iconPath,
    accessibilityInformation: { label: `${state.target.label}, ${description}` }
  };
}
