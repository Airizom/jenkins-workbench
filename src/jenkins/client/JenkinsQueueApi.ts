import { JenkinsRequestError } from "../errors";
import type { JenkinsQueueItem } from "../types";
import { buildApiUrlFromBase } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

interface JenkinsQueueResponse {
  items?: JenkinsQueueItem[];
}

export class JenkinsQueueApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getQueue(): Promise<JenkinsQueueItem[]> {
    const tree =
      "items[id,task[name,url,labelExpression],why,inQueueSince,blocked,buildable,stuck,assignedLabel[name]]";
    const url = buildApiUrlFromBase(this.context.baseUrl, "queue/api/json", tree);
    const response = await this.context.requestJson<JenkinsQueueResponse>(url);
    return Array.isArray(response.items) ? response.items : [];
  }

  async getQueueItem(id: number): Promise<JenkinsQueueItem> {
    const validId = validateQueueItemId(id);
    const tree =
      "id,task[name,url,labelExpression],why,inQueueSince,blocked,buildable,stuck,assignedLabel[name],cancelled,executable[number,url]";
    const url = buildApiUrlFromBase(this.context.baseUrl, `queue/item/${validId}/api/json`, tree);
    return this.context.requestJson<JenkinsQueueItem>(url);
  }

  async cancelQueueItem(id: number): Promise<void> {
    const validId = validateQueueItemId(id);
    const url = new URL(buildApiUrlFromBase(this.context.baseUrl, "queue/cancelItem"));
    url.searchParams.set("id", validId.toString());
    await this.context.requestVoidWithCrumb(url.toString());
  }
}

function validateQueueItemId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new JenkinsRequestError("Invalid Jenkins queue item ID.");
  }
  return id;
}
