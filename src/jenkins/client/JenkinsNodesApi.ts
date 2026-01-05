import type { JenkinsNode } from "../types";
import { buildApiUrlFromBase } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsNodesApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getNodes(): Promise<JenkinsNode[]> {
    const url = buildApiUrlFromBase(
      this.context.baseUrl,
      "computer/api/json",
      "computer[displayName,offline,temporarilyOffline,numExecutors,busyExecutors]"
    );
    const response = await this.context.requestJson<{ computer?: JenkinsNode[] }>(url);
    return Array.isArray(response.computer) ? response.computer : [];
  }
}
