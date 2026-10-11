import type { JenkinsNodeDetails } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { resolveNodeUrl } from "../urls";
import { toJenkinsActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type { JenkinsNodeInfo } from "./JenkinsDataTypes";

export type NodeOfflineToggleStatus = "toggled" | "no_change" | "not_temporarily_offline";

export interface NodeOfflineToggleResult {
  status: NodeOfflineToggleStatus;
  details: JenkinsNodeDetails;
}

export type NodeLaunchStatus = "launched" | "no_change" | "not_launchable" | "temporarily_offline";

export interface NodeLaunchResult {
  status: NodeLaunchStatus;
  details: JenkinsNodeDetails;
}

export class JenkinsNodeDataOperations {
  private readonly pendingOfflineOperations = new Map<string, Promise<void>>();

  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getNodes(
    environment: JenkinsEnvironmentRef,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<JenkinsNodeInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "nodes");
    if (options?.mode === "refresh") {
      return this.context.getCache().withWriteGuard([cacheKey], async (cache) => {
        const nodes = await this.loadNodes(environment);
        cache.set(cacheKey, nodes, this.context.getCacheTtlMs());
        return nodes;
      });
    }
    return this.context
      .getCache()
      .getOrLoad(cacheKey, () => this.loadNodes(environment), this.context.getCacheTtlMs());
  }

  private async loadNodes(environment: JenkinsEnvironmentRef): Promise<JenkinsNodeInfo[]> {
    const client = await this.context.getClient(environment);
    const nodes = await client.getNodes();
    return nodes.map((node) => ({
      ...node,
      nodeUrl: resolveNodeUrl(environment.url, node)
    }));
  }

  async getNodeDetails(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    options?: { mode?: "refresh"; detailLevel?: "basic" | "advanced" }
  ): Promise<JenkinsNodeDetails> {
    const detailLevel = options?.detailLevel ?? "basic";
    const cacheKey = await this.context.buildCacheKey(
      environment,
      `node-details-${detailLevel}`,
      nodeUrl
    );
    const cached =
      options?.mode !== "refresh"
        ? this.context.getCache().get<JenkinsNodeDetails>(cacheKey)
        : undefined;
    if (cached) {
      return cached;
    }
    return this.context.getCache().withWriteGuard([cacheKey], async (cache) => {
      const client = await this.context.getClient(environment);
      try {
        const details = await client.getNodeDetails(nodeUrl, { detailLevel });
        cache.set(cacheKey, details, this.context.getCacheTtlMs());
        return details;
      } catch (error) {
        throw toJenkinsActionError(error);
      }
    });
  }

  async setNodeTemporarilyOffline(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    targetOffline: boolean,
    reason?: string
  ): Promise<NodeOfflineToggleResult> {
    // Serialize the entire read/check/toggle sequence because toggleOffline is not idempotent.
    const operationKey = JSON.stringify([environment.environmentId, environment.url, nodeUrl]);
    const previous = this.pendingOfflineOperations.get(operationKey);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pendingOfflineOperations.set(operationKey, pending);
    await previous;

    try {
      const details = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      const isOffline = details.offline === true;
      const isTemporarilyOffline = details.temporarilyOffline === true;

      if (targetOffline) {
        if (isTemporarilyOffline) {
          return { status: "no_change", details };
        }
      } else if (!isTemporarilyOffline) {
        return { status: isOffline ? "not_temporarily_offline" : "no_change", details };
      }
      this.context.clearCacheForEnvironment(environment.environmentId);
      const client = await this.context.getClient(environment);
      await client.toggleNodeTemporarilyOffline(nodeUrl, targetOffline ? reason : undefined);
      const refreshed = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      return { status: "toggled", details: refreshed };
    } catch (error) {
      throw toJenkinsActionError(error);
    } finally {
      release();
      if (this.pendingOfflineOperations.get(operationKey) === pending) {
        this.pendingOfflineOperations.delete(operationKey);
      }
    }
  }

  async launchNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeLaunchResult> {
    try {
      const details = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      const canLaunch = details.launchSupported === true;
      if (!details.offline) {
        return { status: "no_change", details };
      }
      if (details.temporarilyOffline) {
        return { status: "temporarily_offline", details };
      }
      if (!canLaunch) {
        return { status: "not_launchable", details };
      }
      this.context.clearCacheForEnvironment(environment.environmentId);
      const client = await this.context.getClient(environment);
      await client.launchNodeAgent(nodeUrl);
      const refreshed = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      return { status: "launched", details: refreshed };
    } catch (error) {
      throw toJenkinsActionError(error);
    }
  }
}
