import type { JenkinsNode, JenkinsNodeDetails } from "../types";
import { buildActionUrl, buildApiUrlFromBase, buildApiUrlFromItem } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

const NODE_EXECUTABLE_FIELDS =
  "number,url,fullDisplayName,displayName,result,timestamp,duration,estimatedDuration,building";
const NODE_EXECUTOR_FIELDS = [
  "number",
  "progress",
  "idle",
  `currentExecutable[${NODE_EXECUTABLE_FIELDS}]`,
  `currentWorkUnit[${NODE_EXECUTABLE_FIELDS}]`
].join(",");

const NODE_DETAILS_BASE_FIELDS = [
  "_class",
  "displayName",
  "name",
  "description",
  "url",
  "icon",
  "iconClassName",
  "assignedLabels[name]",
  "offline",
  "temporarilyOffline",
  "idle",
  "offlineCauseReason",
  "offlineCause",
  "numExecutors",
  "busyExecutors",
  `executors[${NODE_EXECUTOR_FIELDS}]`,
  `oneOffExecutors[${NODE_EXECUTOR_FIELDS}]`,
  "jnlpAgent",
  "launchSupported",
  "manualLaunchAllowed"
];

const NODE_DETAILS_ADVANCED_FIELDS = [
  ...NODE_DETAILS_BASE_FIELDS,
  "monitorData[*]",
  "loadStatistics[*]"
];

const NODE_DETAILS_BASE_TREE = NODE_DETAILS_BASE_FIELDS.join(",");
const NODE_DETAILS_ADVANCED_TREE = NODE_DETAILS_ADVANCED_FIELDS.join(",");

export class JenkinsNodesApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getNodes(): Promise<JenkinsNode[]> {
    const url = buildApiUrlFromBase(
      this.context.baseUrl,
      "computer/api/json",
      "computer[displayName,name,url,assignedLabels[name],offline,temporarilyOffline,offlineCauseReason,offlineCause[description,shortDescription,name,timestamp],numExecutors,busyExecutors,jnlpAgent,launchSupported,manualLaunchAllowed]"
    );
    const response = await this.context.requestJson<{ computer?: JenkinsNode[] }>(url);
    return Array.isArray(response.computer) ? response.computer : [];
  }

  async getNodeDetails(
    nodeUrl: string,
    options?: { detailLevel?: "basic" | "advanced" }
  ): Promise<JenkinsNodeDetails> {
    const tree =
      options?.detailLevel === "advanced" ? NODE_DETAILS_ADVANCED_TREE : NODE_DETAILS_BASE_TREE;
    const url = buildApiUrlFromItem(nodeUrl, tree);
    return this.context.requestJson<JenkinsNodeDetails>(url);
  }

  async toggleNodeTemporarilyOffline(nodeUrl: string, offlineMessage?: string): Promise<void> {
    const url = buildActionUrl(nodeUrl, "toggleOffline");
    const trimmed = offlineMessage?.trim();
    const body = trimmed ? new URLSearchParams({ offlineMessage: trimmed }).toString() : undefined;
    await this.context.requestVoidWithCrumb(url, body);
  }

  async launchNodeAgent(nodeUrl: string): Promise<void> {
    const url = buildActionUrl(nodeUrl, "launchSlaveAgent");
    await this.context.requestVoidWithCrumb(url);
  }
}
