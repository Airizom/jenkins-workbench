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
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getNodes(environment: JenkinsEnvironmentRef): Promise<JenkinsNodeInfo[]> {
    const cacheKey = await this.context.buildCacheKey(environment, "nodes");
    return this.context.getCache().getOrLoad(
      cacheKey,
      async () => {
        const client = await this.context.getClient(environment);
        const nodes = await client.getNodes();
        return nodes.map((node) => ({
          ...node,
          nodeUrl: resolveNodeUrl(environment.url, node)
        }));
      },
      this.context.getCacheTtlMs()
    );
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
    const client = await this.context.getClient(environment);
    try {
      const details = await client.getNodeDetails(nodeUrl, { detailLevel });
      this.context.getCache().set(cacheKey, details, this.context.getCacheTtlMs());
      return details;
    } catch (error) {
      throw toJenkinsActionError(error);
    }
  }

  async setNodeTemporarilyOffline(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    targetOffline: boolean,
    reason?: string
  ): Promise<NodeOfflineToggleResult> {
    try {
      const details = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      const isOffline = details.offline === true;
      const isTemporarilyOffline = details.temporarilyOffline === true;

      if (targetOffline) {
        if (isTemporarilyOffline || isOffline) {
          return { status: "no_change", details };
        }
        this.context.clearCacheForEnvironment(environment.environmentId);
        const client = await this.context.getClient(environment);
        await client.toggleNodeTemporarilyOffline(nodeUrl, reason);
        const refreshed = await this.getNodeDetails(environment, nodeUrl, {
          mode: "refresh",
          detailLevel: "basic"
        });
        return { status: "toggled", details: refreshed };
      }

      if (!isTemporarilyOffline) {
        return { status: isOffline ? "not_temporarily_offline" : "no_change", details };
      }
      this.context.clearCacheForEnvironment(environment.environmentId);
      const client = await this.context.getClient(environment);
      await client.toggleNodeTemporarilyOffline(nodeUrl);
      const refreshed = await this.getNodeDetails(environment, nodeUrl, {
        mode: "refresh",
        detailLevel: "basic"
      });
      return { status: "toggled", details: refreshed };
    } catch (error) {
      throw toJenkinsActionError(error);
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
