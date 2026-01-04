import type { JenkinsQueueItem } from "../types";
import { buildApiUrlFromBase } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

interface JenkinsQueueResponse {
  items?: JenkinsQueueItem[];
}

export class JenkinsQueueApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getQueue(): Promise<JenkinsQueueItem[]> {
    const tree = "items[id,task[name,url],why,inQueueSince,blocked,buildable,stuck]";
    const url = buildApiUrlFromBase(this.context.baseUrl, "queue/api/json", tree);
    const response = await this.context.requestJson<JenkinsQueueResponse>(url);
    return Array.isArray(response.items) ? response.items : [];
  }

  async cancelQueueItem(id: number): Promise<void> {
    const url = new URL(buildApiUrlFromBase(this.context.baseUrl, "queue/cancelItem"));
    url.searchParams.set("id", Math.floor(id).toString());
    await this.context.requestVoidWithCrumb(url.toString());
  }
}
