import type { NodeAgentLogOptions, NodeAgentLogResult } from "../NodeManagement";
import type { JenkinsNode, JenkinsNodeDetails } from "../types";
import { buildActionUrl, buildApiUrlFromBase, buildApiUrlFromItem } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { JenkinsNodeLogClient } from "./JenkinsNodeLogClient";

const NODE_EXECUTABLE_FIELDS =
  "number,url,fullDisplayName,displayName,result,timestamp,duration,estimatedDuration,building";
const NODE_EXECUTOR_FIELDS = [
  "number",
  "progress",
  "idle",
  `currentExecutable[${NODE_EXECUTABLE_FIELDS}]`,
  `currentWorkUnit[${NODE_EXECUTABLE_FIELDS}]`
].join(",");
const NODE_EXECUTORS_FIELD = `executors[${NODE_EXECUTOR_FIELDS}]`;
const NODE_LIST_TREE = [
  "computer[displayName,name,url,assignedLabels[name],offline,temporarilyOffline,",
  "offlineCauseReason,offlineCause[description,shortDescription,name,timestamp],",
  `numExecutors,busyExecutors,${NODE_EXECUTORS_FIELD},jnlpAgent,launchSupported,manualLaunchAllowed]`
].join("");

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
  NODE_EXECUTORS_FIELD,
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
    const url = buildApiUrlFromBase(this.context.baseUrl, "computer/api/json", NODE_LIST_TREE);
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
  async getNodeConfigXml(nodeUrl: string): Promise<string> {
    return this.context.requestText(buildActionUrl(nodeUrl, "config.xml"));
  }

  async updateNodeConfigXml(nodeUrl: string, xml: string): Promise<void> {
    await this.context.requestPostWithCrumbRaw(buildActionUrl(nodeUrl, "config.xml"), xml, {
      "Content-Type": "application/xml; charset=utf-8"
    });
  }

  async disconnectNodeAgent(nodeUrl: string, reason?: string): Promise<void> {
    const body = new URLSearchParams({ offlineMessage: reason?.trim() ?? "" }).toString();
    await this.context.requestVoidWithCrumb(buildActionUrl(nodeUrl, "doDisconnect"), body);
  }

  async deleteNode(nodeUrl: string): Promise<void> {
    await this.context.requestVoidWithCrumb(buildActionUrl(nodeUrl, "doDelete"));
  }

  async createNode(name: string, xml: string): Promise<void> {
    const url = new URL(buildActionUrl(this.context.baseUrl, "computer/createItem"));
    url.searchParams.set("name", name);
    await this.context.requestPostWithCrumbRaw(url.toString(), xml, {
      "Content-Type": "application/xml; charset=utf-8"
    });
  }

  async copyNode(sourceName: string, name: string): Promise<void> {
    const url = buildActionUrl(this.context.baseUrl, "computer/createItem");
    const body = new URLSearchParams({ name, mode: "copy", from: sourceName }).toString();
    await this.context.requestVoidWithCrumb(url, body);
  }

  async getNodeAgentLog(
    nodeUrl: string,
    options?: NodeAgentLogOptions
  ): Promise<NodeAgentLogResult> {
    return new JenkinsNodeLogClient(this.context).getLog(nodeUrl, options);
  }
}
