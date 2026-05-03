import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  NodeCapacityNodeExecutorsUpdateMessage,
  NodeCapacityViewModel
} from "../shared/nodeCapacity/NodeCapacityContracts";
import {
  buildNodeCapacityExecutorViewModels,
  buildNodeCapacityViewModel
} from "./NodeCapacityViewModelBuilder";

const NODE_CAPACITY_EXECUTOR_HYDRATION_CONCURRENCY = 4;

type NodeCapacityExecutorHydrationEntry = NodeCapacityNodeExecutorsUpdateMessage["payload"][number];

export class NodeCapacityService {
  private readonly executorHydrationRequests = new Map<
    string,
    Promise<NodeCapacityExecutorHydrationEntry>
  >();

  constructor(private readonly dataService: JenkinsDataService) {}

  async getNodeCapacity(environment: JenkinsEnvironmentRef): Promise<NodeCapacityViewModel> {
    const updatedAt = new Date().toISOString();
    const [nodes, queueItems] = await Promise.all([
      this.dataService.getNodes(environment, { mode: "refresh" }),
      this.dataService.getQueueItems(environment)
    ]);
    return buildNodeCapacityViewModel(environment, nodes, queueItems, updatedAt);
  }

  async hydrateNodeExecutors(
    environment: JenkinsEnvironmentRef,
    nodeUrls: string[]
  ): Promise<NodeCapacityNodeExecutorsUpdateMessage["payload"]> {
    const uniqueNodeUrls = [...new Set(nodeUrls.filter((nodeUrl) => nodeUrl.trim().length > 0))];
    return runWithConcurrency(
      uniqueNodeUrls,
      NODE_CAPACITY_EXECUTOR_HYDRATION_CONCURRENCY,
      (nodeUrl) => this.hydrateNodeExecutorsForNode(environment, nodeUrl)
    );
  }

  private hydrateNodeExecutorsForNode(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeCapacityExecutorHydrationEntry> {
    const key = buildExecutorHydrationKey(environment, nodeUrl);
    const existing = this.executorHydrationRequests.get(key);
    if (existing) {
      return existing;
    }

    const request = this.loadNodeExecutors(environment, nodeUrl).finally(() => {
      this.executorHydrationRequests.delete(key);
    });
    this.executorHydrationRequests.set(key, request);
    return request;
  }

  private async loadNodeExecutors(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeCapacityExecutorHydrationEntry> {
    const details = await this.dataService.getNodeDetails(environment, nodeUrl, {
      mode: "refresh",
      detailLevel: "basic"
    });
    return { nodeUrl, executors: buildNodeCapacityExecutorViewModels(details) };
  }
}

function buildExecutorHydrationKey(environment: JenkinsEnvironmentRef, nodeUrl: string): string {
  return `${environment.scope}:${environment.environmentId}:${nodeUrl}`;
}

async function runWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }
  const results: TResult[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex]);
      }
    })
  );

  return results;
}
