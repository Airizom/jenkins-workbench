import { trimToUndefined } from "../../shared/stringValues";
import type {
  JenkinsClient,
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
    return this.runBuildAction(environment, async (client) => {
      const items = await client.getQueue();
      return this.mapQueueItems(items);
    });
  }

  async getQueueItem(
    environment: JenkinsEnvironmentRef,
    queueId: number
  ): Promise<JenkinsQueueItem> {
    return this.runBuildAction(environment, (client) => client.getQueueItem(queueId));
  }

  async cancelQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<void> {
    await this.runBuildAction(environment, (client) => client.cancelQueueItem(queueId));
  }

  async enableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    await this.runBuildAction(environment, (client) => client.enableJob(jobUrl));
  }

  async disableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    await this.runBuildAction(environment, (client) => client.disableJob(jobUrl));
  }

  async scanMultibranch(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<ScanMultibranchResult> {
    return this.runBuildAction(environment, (client) => client.scanMultibranch(folderUrl));
  }

  async renameJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.runJobManagementAction(environment, (client) => client.renameJob(jobUrl, newName));
  }

  async deleteJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    await this.runJobManagementAction(environment, (client) => client.deleteJob(jobUrl));
  }

  async copyJob(
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.runJobManagementAction(environment, (client) =>
      client.copyJob(parentUrl, sourceName, newName)
    );
  }

  async createItem(
    kind: JenkinsItemCreateKind,
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.runJobManagementAction(environment, (client) =>
      client.createItem(kind, parentUrl, newName)
    );
  }

  private runBuildAction<T>(
    environment: JenkinsEnvironmentRef,
    action: (client: JenkinsClient) => Promise<T>
  ): Promise<T> {
    return this.runAction(environment, action, toBuildActionError);
  }

  private runJobManagementAction<T>(
    environment: JenkinsEnvironmentRef,
    action: (client: JenkinsClient) => Promise<T>
  ): Promise<T> {
    return this.runAction(environment, action, toJobManagementActionError);
  }

  private async runAction<T>(
    environment: JenkinsEnvironmentRef,
    action: (client: JenkinsClient) => Promise<T>,
    mapError: (error: unknown) => Error
  ): Promise<T> {
    const client = await this.context.getClient(environment);
    try {
      return await action(client);
    } catch (error) {
      throw mapError(error);
    }
  }

  private mapQueueItems(items: JenkinsQueueItem[]): JenkinsQueueItemInfo[] {
    return items.map((item, index) => {
      const name = trimToUndefined(item.task?.name) ?? `Queue item ${item.id}`;
      return {
        id: item.id,
        name,
        position: index + 1,
        reason: trimToUndefined(item.why),
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
