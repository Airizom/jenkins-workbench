import type { JenkinsFlowNodeLog } from "../../jenkins/types";
import { escapeHtml } from "../../shared/html";
import { isWorkflowNodeActive } from "./PipelineWorkflowStatus";

export interface FlowNodeLogSnapshotContent {
  html: string;
  text: string;
  hasMore: boolean;
  active: boolean;
  consoleUrl?: string;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function readFlowNodeLogSnapshot(snapshot: JenkinsFlowNodeLog): FlowNodeLogSnapshotContent {
  const text = htmlToText(snapshot.text ?? "");
  return {
    html: escapeHtml(text),
    text,
    // `hasMore` marks truncation, not activity; only an active node can change.
    hasMore: Boolean(snapshot.hasMore),
    active: isWorkflowNodeActive(snapshot.nodeStatus),
    consoleUrl: snapshot.consoleUrl
  };
}
