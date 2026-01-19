import type { JenkinsNode, JenkinsNodeDetails } from "../types";
import { buildApiUrlFromBase, buildApiUrlFromItem } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

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
  "executors[number,progress,idle,currentExecutable[number,url,fullDisplayName,displayName,result],currentWorkUnit[number,url,fullDisplayName,displayName,result]]",
  "oneOffExecutors[number,progress,idle,currentExecutable[number,url,fullDisplayName,displayName,result],currentWorkUnit[number,url,fullDisplayName,displayName,result]]",
  "jnlpAgent",
  "launchSupported",
  "manualLaunchAllowed"
];

const NODE_DETAILS_ADVANCED_FIELDS = [...NODE_DETAILS_BASE_FIELDS, "monitorData[*]", "loadStatistics[*]"];

const NODE_DETAILS_BASE_TREE = NODE_DETAILS_BASE_FIELDS.join(",");
const NODE_DETAILS_ADVANCED_TREE = NODE_DETAILS_ADVANCED_FIELDS.join(",");

export class JenkinsNodesApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getNodes(): Promise<JenkinsNode[]> {
    const url = buildApiUrlFromBase(
      this.context.baseUrl,
      "computer/api/json",
      "computer[displayName,name,url,assignedLabels[name],offline,temporarilyOffline,numExecutors,busyExecutors]"
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
}
