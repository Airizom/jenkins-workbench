import type { JenkinsNodeDetails } from "../JenkinsClient";
import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import {
  buildInboundNodeConfiguration,
  readNodeConfiguration,
  updateNodeConfigurationLabels
} from "../NodeConfigurationXml";
import { canonicalNodeUrl } from "../NodeIdentity";
import {
  type NodeAgentLogOptions,
  type NodeAgentLogResult,
  type NodeConfiguration,
  type NodeCreateInput,
  type NodeCreationResult,
  type NodeLabelsUpdateResult,
  UnsupportedNodeConfigurationError,
  validateNodeName
} from "../NodeManagement";
import { buildActionUrl, resolveNodeUrl } from "../urls";
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
  private readonly pendingOperations = new Map<string, Promise<void>>();

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
    return this.runMutation(environment, nodeUrl, async () => {
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
      }
    });
  }

  async launchNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeLaunchResult> {
    return this.runMutation(environment, nodeUrl, async () => {
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
    });
  }
  async getNodeConfiguration(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeConfiguration> {
    const client = await this.context.getClient(environment);
    const configuration = readNodeConfiguration(await client.getNodeConfigXml(nodeUrl));
    this.assertConfigurationTarget(environment, nodeUrl, configuration);
    return configuration;
  }

  async updateNodeLabels(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    labels: string,
    expectedLabels: string
  ): Promise<NodeLabelsUpdateResult> {
    return this.runMutation(environment, nodeUrl, async () => {
      const client = await this.context.getClient(environment);
      const xml = await client.getNodeConfigXml(nodeUrl);
      const configuration = readNodeConfiguration(xml);
      this.assertConfigurationTarget(environment, nodeUrl, configuration);
      const normalized = labels.trim();
      if (configuration.labels !== expectedLabels)
        return { status: "conflict", labels: configuration.labels };
      if (normalized === configuration.labels)
        return { status: "no_change", labels: configuration.labels };
      this.context.clearCacheForEnvironment(environment.environmentId);
      try {
        await client.updateNodeConfigXml(nodeUrl, updateNodeConfigurationLabels(xml, normalized));
      } catch (error) {
        throw toJenkinsActionError(error);
      } finally {
        this.context.clearCacheForEnvironment(environment.environmentId);
      }
      return { status: "updated", labels: normalized };
    });
  }

  async disconnectNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    reason?: string
  ): Promise<{ status: "requested" | "no_change"; details: JenkinsNodeDetails }> {
    return this.runMutation(environment, nodeUrl, async () => {
      const details = await this.getNodeDetails(environment, nodeUrl, { mode: "refresh" });
      if (details.offline && !details.temporarilyOffline) return { status: "no_change", details };
      if (
        details._class?.includes("MasterComputer") ||
        details._class?.includes("BuiltInComputer")
      ) {
        throw new UnsupportedNodeConfigurationError();
      }
      const client = await this.context.getClient(environment);
      this.context.clearCacheForEnvironment(environment.environmentId);
      try {
        await client.disconnectNodeAgent(nodeUrl, reason);
      } catch (error) {
        throw toJenkinsActionError(error);
      } finally {
        this.context.clearCacheForEnvironment(environment.environmentId);
      }
      return { status: "requested", details };
    });
  }

  async checkNodeDeletion(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<JenkinsNodeDetails> {
    await this.getNodeConfiguration(environment, nodeUrl);
    const details = await this.getNodeDetails(environment, nodeUrl, { mode: "refresh" });
    if (!isNodeDefinitelyIdle(details)) {
      throw new Error(
        "The node is busy or its running work cannot be verified. Wait for all work to finish before deleting it."
      );
    }
    return details;
  }

  async deleteNode(environment: JenkinsEnvironmentRef, nodeUrl: string): Promise<void> {
    return this.runMutation(environment, nodeUrl, async () => {
      await this.checkNodeDeletion(environment, nodeUrl);
      const client = await this.context.getClient(environment);
      this.context.clearCacheForEnvironment(environment.environmentId);
      try {
        await client.deleteNode(nodeUrl);
      } catch (error) {
        throw toJenkinsActionError(error);
      } finally {
        this.context.clearCacheForEnvironment(environment.environmentId);
      }
    });
  }

  async createNode(
    environment: JenkinsEnvironmentRef,
    input: NodeCreateInput
  ): Promise<NodeCreationResult> {
    const xml = buildInboundNodeConfiguration(input);
    const nodeUrl = buildActionUrl(environment.url, `computer/${encodeURIComponent(input.name)}/`);
    return this.runMutation(environment, nodeUrl, async () => {
      await this.assertNameAvailable(environment, input.name);
      const client = await this.context.getClient(environment);
      return this.performCreation(environment, nodeUrl, input.name, "created", () =>
        client.createNode(input.name, xml)
      );
    });
  }

  async copyNode(
    environment: JenkinsEnvironmentRef,
    sourceUrl: string,
    name: string
  ): Promise<NodeCreationResult> {
    const nameError = validateNodeName(name);
    if (nameError) throw new Error(nameError);
    const nodeUrl = buildActionUrl(environment.url, `computer/${encodeURIComponent(name)}/`);
    return this.runMutations(environment, [sourceUrl, nodeUrl], async () => {
      const source = await this.getNodeConfiguration(environment, sourceUrl);
      await this.assertNameAvailable(environment, name);
      const client = await this.context.getClient(environment);
      return this.performCreation(environment, nodeUrl, name, "copied", () =>
        client.copyNode(source.name, name)
      );
    });
  }

  async getNodeAgentLog(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    options?: NodeAgentLogOptions
  ): Promise<NodeAgentLogResult> {
    const client = await this.context.getClient(environment);
    return client.getNodeAgentLog(nodeUrl, options);
  }

  private async assertNameAvailable(
    environment: JenkinsEnvironmentRef,
    name: string
  ): Promise<void> {
    const nodes = await this.getNodes(environment, { mode: "refresh" });
    const expectedUrl = buildActionUrl(environment.url, `computer/${encodeURIComponent(name)}/`);
    if (nodes.some((node) => node.name === name || node.nodeUrl === expectedUrl)) {
      throw new Error(`A node named "${name}" already exists.`);
    }
  }

  private async performCreation(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    name: string,
    status: "created" | "copied",
    create: () => Promise<void>
  ): Promise<NodeCreationResult> {
    this.context.clearCacheForEnvironment(environment.environmentId);
    try {
      await create();
      return { nodeUrl, status };
    } catch (error) {
      // A dropped response may follow a successful creation. Never retry the POST.
      try {
        const nodes = await this.getNodes(environment, { mode: "refresh" });
        if (nodes.some((node) => node.name === name || node.nodeUrl === nodeUrl)) {
          return { nodeUrl, status: "exists_after_error" };
        }
      } catch {
        /* Preserve the original mutation failure. */
      }
      throw toJenkinsActionError(error);
    } finally {
      this.context.clearCacheForEnvironment(environment.environmentId);
    }
  }

  private assertConfigurationTarget(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    configuration: NodeConfiguration
  ): void {
    const expected = buildActionUrl(
      environment.url,
      `computer/${encodeURIComponent(configuration.name)}/`
    );
    if (canonicalNodeUrl(nodeUrl) !== canonicalNodeUrl(expected)) {
      throw new UnsupportedNodeConfigurationError();
    }
  }

  private runMutations<T>(
    environment: JenkinsEnvironmentRef,
    nodeUrls: string[],
    operation: () => Promise<T>
  ): Promise<T> {
    const urls = [...new Set(nodeUrls.map(canonicalNodeUrl))].sort();
    const acquire = (index: number): Promise<T> =>
      index === urls.length
        ? operation()
        : this.runMutation(environment, urls[index], () => acquire(index + 1));
    return acquire(0);
  }

  private async runMutation<T>(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const key = JSON.stringify([
      environment.scope,
      environment.environmentId,
      canonicalNodeUrl(environment.url),
      canonicalNodeUrl(nodeUrl)
    ]);
    const previous = this.pendingOperations.get(key);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pendingOperations.set(key, pending);
    await previous;
    try {
      return await operation();
    } finally {
      this.context.clearCacheForEnvironment(environment.environmentId);
      release();
      if (this.pendingOperations.get(key) === pending) this.pendingOperations.delete(key);
    }
  }
}

export function isNodeDefinitelyIdle(details: JenkinsNodeDetails): boolean {
  // Jenkins core does not export busyExecutors on every version. Complete, explicitly
  // idle executor observations establish idleness; a provided counter must agree.
  if (
    details.idle !== true ||
    (details.busyExecutors !== undefined && details.busyExecutors !== 0) ||
    !Number.isSafeInteger(details.numExecutors) ||
    (details.numExecutors ?? -1) < 0
  )
    return false;
  if (
    !Array.isArray(details.executors) ||
    details.executors.length !== details.numExecutors ||
    !Array.isArray(details.oneOffExecutors)
  )
    return false;
  return [...details.executors, ...details.oneOffExecutors].every(
    (executor) => executor.idle === true && !executor.currentExecutable && !executor.currentWorkUnit
  );
}
