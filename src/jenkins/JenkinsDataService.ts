import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer
} from "./BuildParameterRequests";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "./coverage/JenkinsCoverageTypes";
import { JenkinsBuildDataOperations } from "./data/JenkinsBuildDataOperations";
import {
  JenkinsCoverageDataOperations,
  type JenkinsCoverageRequestOptions
} from "./data/JenkinsCoverageDataOperations";
import { JenkinsDataRuntimeContext } from "./data/JenkinsDataRuntimeContext";
import type {
  ConsoleTextResult,
  ConsoleTextTailResult,
  FlowNodeDetailsResult,
  FlowNodeLogResult,
  JenkinsJobCollectionRequest,
  JenkinsJobFetchOptions,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JenkinsViewInfo,
  JobParameter,
  JobSearchEntry,
  JobSearchOptions,
  PendingInputAction,
  PendingInputSummary,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./data/JenkinsDataTypes";
import { JenkinsJobDataOperations } from "./data/JenkinsJobDataOperations";
import { JenkinsJobIndex } from "./data/JenkinsJobIndex";
import type { NodeLaunchResult, NodeOfflineToggleResult } from "./data/JenkinsNodeDataOperations";
import { JenkinsNodeDataOperations } from "./data/JenkinsNodeDataOperations";
import { JenkinsPendingInputDataOperations } from "./data/JenkinsPendingInputDataOperations";
import { JenkinsQueueAndJobManagementOperations } from "./data/JenkinsQueueAndJobManagementOperations";
import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsItemCreateKind,
  JenkinsJob,
  JenkinsNodeDetails,
  JenkinsQueueItem,
  JenkinsRestartFromStageInfo,
  JenkinsWorkflowRun,
  JenkinsWorkspaceEntry,
  ScanMultibranchResult
} from "./JenkinsClient";
import type { JenkinsClientProvider } from "./JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload,
  JenkinsTestReport
} from "./types";

export type {
  BuildParameterPayload,
  BuildParameterRequestPreparer
} from "./BuildParameterRequests";
export type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "./coverage/JenkinsCoverageTypes";
export type { JenkinsCoverageRequestOptions } from "./data/JenkinsCoverageDataOperations";
export type {
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobCollectionRequest,
  JenkinsJobFetchOptions,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JenkinsViewInfo,
  JobParameter,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions,
  PendingInputAction,
  PendingInputSummary,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult
} from "./data/JenkinsDataTypes";
export { CancellationError } from "./errors";
export type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
} from "./types";

export interface JenkinsDataServiceOptions {
  buildParameterRequestPreparer: BuildParameterRequestPreparer;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface BuildListFetchOptions {
  detailLevel?: "summary" | "details";
  includeParameters?: boolean;
  bypassCache?: boolean;
}

// Artifact consumers receive structural adapters from the DI catalog, so Fallow
// needs an explicit runtime surface to retain these live facade methods.
interface JenkinsArtifactRetrievalRuntimeSurface {
  getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse>;
  getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse>;
}

export class JenkinsDataService implements JenkinsArtifactRetrievalRuntimeSurface {
  private readonly runtimeContext: JenkinsDataRuntimeContext;
  private readonly jobIndex: JenkinsJobIndex;
  private readonly buildOperations: JenkinsBuildDataOperations;
  private readonly coverageOperations: JenkinsCoverageDataOperations;
  private readonly pendingInputOperations: JenkinsPendingInputDataOperations;
  private readonly nodeOperations: JenkinsNodeDataOperations;
  private readonly jobOperations: JenkinsJobDataOperations;
  private readonly queueAndJobManagementOperations: JenkinsQueueAndJobManagementOperations;

  constructor(clientProvider: JenkinsClientProvider, options: JenkinsDataServiceOptions) {
    this.runtimeContext = new JenkinsDataRuntimeContext(clientProvider, options);
    this.jobIndex = new JenkinsJobIndex(this.runtimeContext.getCache(), clientProvider);
    this.buildOperations = new JenkinsBuildDataOperations(this.runtimeContext);
    this.coverageOperations = new JenkinsCoverageDataOperations(this.runtimeContext);
    this.pendingInputOperations = new JenkinsPendingInputDataOperations(this.runtimeContext);
    this.nodeOperations = new JenkinsNodeDataOperations(this.runtimeContext);
    this.jobOperations = new JenkinsJobDataOperations(this.runtimeContext);
    this.queueAndJobManagementOperations = new JenkinsQueueAndJobManagementOperations(
      this.runtimeContext
    );
  }

  clearCache(): void {
    this.runtimeContext.clearCache();
  }

  clearCacheForEnvironment(environmentId: string): void {
    this.runtimeContext.clearCacheForEnvironment(environmentId);
  }

  // Called by configuration subscriptions that Fallow cannot trace through the service container.
  // fallow-ignore-next-line unused-class-member
  updateCacheTtlMs(cacheTtlMs?: number): void {
    this.runtimeContext.setCacheTtlMs(cacheTtlMs);
  }

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    return this.jobOperations.getJob(environment, jobUrl);
  }

  async getJobInfo(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJobInfo> {
    return this.jobOperations.getJobInfo(environment, jobUrl);
  }

  async getJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string,
    options?: JenkinsJobFetchOptions
  ): Promise<JenkinsJobInfo[]> {
    return this.jobOperations.getJobsForFolder(environment, folderUrl, options);
  }

  async getJobCollection(
    environment: JenkinsEnvironmentRef,
    request: JenkinsJobCollectionRequest
  ): Promise<JenkinsJobInfo[]> {
    return this.jobOperations.getJobCollection(environment, request);
  }

  async getViewsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsViewInfo[]> {
    return this.jobOperations.getViewsForEnvironment(environment);
  }

  async getAllJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    return this.jobIndex.getAllJobsForEnvironment(environment, options);
  }

  async getMultibranchJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    return this.jobIndex.getMultibranchJobsForEnvironment(environment, options);
  }

  async *iterateJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): AsyncIterable<JobSearchEntry[]> {
    for await (const batch of this.jobIndex.iterateJobsForEnvironment(environment, options)) {
      yield batch;
    }
  }

  async getBuildsForJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    limit: number,
    options?: BuildListFetchOptions
  ): Promise<JenkinsBuild[]> {
    return this.buildOperations.getBuildsForJob(environment, jobUrl, limit, options);
  }

  async getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { includeParameters?: boolean }
  ): Promise<JenkinsBuildDetails> {
    return this.buildOperations.getBuildDetails(environment, buildUrl, options);
  }

  async getBuildArtifacts(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsArtifact[]> {
    return this.buildOperations.getBuildArtifacts(environment, buildUrl);
  }

  async getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined> {
    return this.buildOperations.getWorkflowRun(environment, buildUrl);
  }

  async discoverCoverageActionPath(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<string | undefined> {
    return this.coverageOperations.discoverCoverageActionPath(environment, buildUrl, options);
  }

  async getCoverageOverview(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsCoverageOverview | undefined> {
    return this.coverageOperations.getCoverageOverview(environment, buildUrl, options);
  }

  async getModifiedCoverageFiles(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsModifiedCoverageFile[] | undefined> {
    return this.coverageOperations.getModifiedCoverageFiles(environment, buildUrl, options);
  }

  async getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]> {
    return this.pendingInputOperations.getPendingInputActions(environment, buildUrl, options);
  }

  async getPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh"; maxAgeMs?: number }
  ): Promise<PendingInputSummary> {
    return this.pendingInputOperations.getPendingInputSummary(environment, buildUrl, options);
  }

  async refreshPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<PendingInputSummary> {
    return this.pendingInputOperations.refreshPendingInputSummary(environment, buildUrl);
  }

  async approveInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    return this.pendingInputOperations.approveInput(environment, buildUrl, inputId, options);
  }

  async rejectInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    abortUrl?: string
  ): Promise<void> {
    return this.pendingInputOperations.rejectInput(environment, buildUrl, inputId, abortUrl);
  }

  async getArtifact(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.buildOperations.getArtifact(environment, buildUrl, relativePath, options);
  }

  async getArtifactStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.buildOperations.getArtifactStream(environment, buildUrl, relativePath, options);
  }

  async getWorkspaceEntries(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath?: string
  ): Promise<JenkinsWorkspaceEntry[]> {
    const client = await this.runtimeContext.getClient(environment);
    return client.getWorkspaceEntries(jobUrl, relativePath);
  }

  async getWorkspaceFile(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const client = await this.runtimeContext.getClient(environment);
    return client.getWorkspaceFile(jobUrl, relativePath, options);
  }

  async getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<ConsoleTextResult> {
    return this.buildOperations.getConsoleText(environment, buildUrl, maxChars);
  }

  async getConsoleTextHead(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxBytes: number
  ): Promise<ConsoleTextResult> {
    return this.buildOperations.getConsoleTextHead(environment, buildUrl, maxBytes);
  }

  async getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<ConsoleTextTailResult> {
    return this.buildOperations.getConsoleTextTail(environment, buildUrl, maxChars);
  }

  async getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<ProgressiveConsoleTextResult> {
    return this.buildOperations.getConsoleTextProgressive(environment, buildUrl, start, maxBytes);
  }

  async getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult> {
    return this.buildOperations.getConsoleHtmlProgressive(environment, buildUrl, start, annotator);
  }

  async getFlowNodeLog(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<FlowNodeLogResult | undefined> {
    return this.buildOperations.getFlowNodeLog(environment, buildUrl, nodeId);
  }

  async getFlowNodeDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<FlowNodeDetailsResult | undefined> {
    return this.buildOperations.getFlowNodeDetails(environment, buildUrl, nodeId);
  }

  async getFlowNodeLogHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult | undefined> {
    return this.buildOperations.getFlowNodeLogHtmlProgressive(
      environment,
      buildUrl,
      nodeId,
      start,
      annotator
    );
  }

  async getLastFailedBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JenkinsBuild | undefined> {
    return this.buildOperations.getLastFailedBuild(environment, jobUrl);
  }

  async getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined> {
    return this.buildOperations.getTestReport(environment, buildUrl, options);
  }

  async getNodes(
    environment: JenkinsEnvironmentRef,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<JenkinsNodeInfo[]> {
    return this.nodeOperations.getNodes(environment, options);
  }

  async getNodeDetails(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    options?: { mode?: "refresh"; detailLevel?: "basic" | "advanced" }
  ): Promise<JenkinsNodeDetails> {
    return this.nodeOperations.getNodeDetails(environment, nodeUrl, options);
  }

  async setNodeTemporarilyOffline(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    targetOffline: boolean,
    reason?: string
  ): Promise<NodeOfflineToggleResult> {
    return this.nodeOperations.setNodeTemporarilyOffline(
      environment,
      nodeUrl,
      targetOffline,
      reason
    );
  }

  async launchNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeLaunchResult> {
    return this.nodeOperations.launchNodeAgent(environment, nodeUrl);
  }

  async getQueueItems(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]> {
    return this.queueAndJobManagementOperations.getQueueItems(environment);
  }

  async getQueueItem(
    environment: JenkinsEnvironmentRef,
    queueId: number
  ): Promise<JenkinsQueueItem> {
    return this.queueAndJobManagementOperations.getQueueItem(environment, queueId);
  }

  async getJobConfigXml(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<string> {
    return this.jobOperations.getJobConfigXml(environment, jobUrl);
  }

  async updateJobConfigXml(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    xml: string
  ): Promise<void> {
    return this.jobOperations.updateJobConfigXml(environment, jobUrl, xml);
  }

  async getJobParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<JobParameter[]> {
    return this.jobOperations.getJobParameters(environment, jobUrl);
  }

  async triggerBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<{ queueLocation?: string }> {
    return this.buildOperations.triggerBuild(environment, jobUrl);
  }

  async triggerBuildWithParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    params?: URLSearchParams | BuildParameterPayload,
    options?: { allowEmptyParams?: boolean }
  ): Promise<{ queueLocation?: string }> {
    return this.buildOperations.triggerBuildWithParameters(environment, jobUrl, params, options);
  }

  async stopBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    return this.buildOperations.stopBuild(environment, buildUrl);
  }

  async quickReplayBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    return this.buildOperations.quickReplayBuild(environment, buildUrl);
  }

  async getReplayDefinition(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsReplayDefinition> {
    return this.buildOperations.getReplayDefinition(environment, buildUrl);
  }

  async runReplay(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    payload: JenkinsReplaySubmissionPayload
  ): Promise<JenkinsReplayResult> {
    return this.buildOperations.runReplay(environment, buildUrl, payload);
  }

  async rebuildBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    return this.buildOperations.rebuildBuild(environment, buildUrl);
  }

  async getRestartFromStageInfo(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsRestartFromStageInfo> {
    return this.buildOperations.getRestartFromStageInfo(environment, buildUrl);
  }

  async restartPipelineFromStage(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    stageName: string
  ): Promise<void> {
    return this.buildOperations.restartPipelineFromStage(environment, buildUrl, stageName);
  }

  async cancelQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<void> {
    return this.queueAndJobManagementOperations.cancelQueueItem(environment, queueId);
  }

  async enableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    return this.queueAndJobManagementOperations.enableJob(environment, jobUrl);
  }

  async disableJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    return this.queueAndJobManagementOperations.disableJob(environment, jobUrl);
  }

  async scanMultibranch(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<ScanMultibranchResult> {
    return this.queueAndJobManagementOperations.scanMultibranch(environment, folderUrl);
  }

  async renameJob(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.queueAndJobManagementOperations.renameJob(environment, jobUrl, newName);
  }

  async deleteJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    return this.queueAndJobManagementOperations.deleteJob(environment, jobUrl);
  }

  async copyJob(
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.queueAndJobManagementOperations.copyJob(
      environment,
      parentUrl,
      sourceName,
      newName
    );
  }

  async createItem(
    kind: JenkinsItemCreateKind,
    environment: JenkinsEnvironmentRef,
    parentUrl: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.queueAndJobManagementOperations.createItem(kind, environment, parentUrl, newName);
  }
}
