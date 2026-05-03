import type {
  JenkinsItemCreateKind,
  JenkinsQueueItem,
  ScanMultibranchResult
} from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { toBuildActionError, toJobManagementActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type { JenkinsQueueItemInfo } from "./JenkinsDataTypes";

export class JenkinsQueueAndJobManagementOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getQueueItems(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]> {
    const client = await this.context.getClient(environment);
    try {
      const items = await client.getQueue();
      return this.mapQueueItems(items);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async getQueueItem(
    environment: JenkinsEnvironmentRef,
    queueId: number
  ): Promise<JenkinsQueueItem> {
    const client = await this.context.getClient(environment);
    try {
      return await client.getQueueItem(queueId);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async cancelQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.cancelQueueItem(queueId);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async enableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.enableJob(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async disableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.disableJob(jobUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async scanMultibranch(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<ScanMultibranchResult> {
    const client = await this.context.getClient(environment);
    try {
      return await client.scanMultibranch(folderUrl);
    } catch (error) {
      throw toBuildActionError(error);
    }
  }

  async renameJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.context.getClient(environment);
    try {
      return await client.renameJob(jobUrl, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async deleteJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.deleteJob(jobUrl);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async copyJob(
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.context.getClient(environment);
    try {
      return await client.copyJob(parentUrl, sourceName, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  async createItem(
    kind: JenkinsItemCreateKind,
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    const client = await this.context.getClient(environment);
    try {
      return await client.createItem(kind, parentUrl, newName);
    } catch (error) {
      throw toJobManagementActionError(error);
    }
  }

  private mapQueueItems(items: JenkinsQueueItem[]): JenkinsQueueItemInfo[] {
    return items.map((item, index) => {
      const name =
        typeof item.task?.name === "string" && item.task.name.trim().length > 0
          ? item.task.name.trim()
          : `Queue item ${item.id}`;
      return {
        id: item.id,
        name,
        position: index + 1,
        reason: typeof item.why === "string" ? item.why.trim() || undefined : undefined,
        inQueueSince: typeof item.inQueueSince === "number" ? item.inQueueSince : undefined,
        taskUrl: item.task?.url,
        assignedLabelName:
          trimToUndefined(item.assignedLabel?.name) ??
          trimToUndefined(item.task?.labelExpression) ??
          inferAssignedLabelFromQueueReason(item.why),
        blocked: item.blocked === true,
        buildable: item.buildable === true,
        stuck: item.stuck === true
      };
    });
  }
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferAssignedLabelFromQueueReason(value: unknown): string | undefined {
  const reason = trimToUndefined(value);
  if (!reason) {
    return undefined;
  }
  return (
    matchFirstGroup(reason, /All nodes of label ['‘"]([^'’"]+)['’"] are offline/i) ??
    matchFirstGroup(reason, /There are no nodes with the label ['‘"]([^'’"]+)['’"]/i)
  );
}

function matchFirstGroup(value: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(value);
  return trimToUndefined(match?.[1]);
}
