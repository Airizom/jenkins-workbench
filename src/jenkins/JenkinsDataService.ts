import type { BuildParameterPayload } from "./BuildParameterRequests";
import type {
  DownstreamBuildSearchOptions,
  DownstreamBuildSearchResult
} from "./BuildRelationships";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "./coverage/JenkinsCoverageTypes";
import { JenkinsBuildDataOperations } from "./data/JenkinsBuildDataOperations";
import { JenkinsBuildRelationships } from "./data/JenkinsBuildRelationships";
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
  JenkinsBuildManagementState,
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
import type {
  BuildListFetchOptions,
  JenkinsDataServiceOptions
} from "./JenkinsDataServiceContracts";
import type {
  JenkinsArtifactRetrievalRuntimeSurface,
  JenkinsBuildInspectionRuntimeSurface,
  JenkinsBuildManagementRuntimeSurface,
  JenkinsBuildRelationshipsRuntimeSurface,
  JenkinsCoverageRuntimeSurface,
  JenkinsJobStateRuntimeSurface,
  JenkinsPendingInputActionRuntimeSurface,
  JenkinsPipelineRestartRuntimeSurface
} from "./JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import type {
  NodeAgentLogOptions,
  NodeAgentLogResult,
  NodeConfiguration,
  NodeCreateInput,
  NodeCreationResult,
  NodeLabelsUpdateResult
} from "./NodeManagement";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload,
  JenkinsTestReport
} from "./types";

export type { BuildParameterPayload } from "./BuildParameterRequests";
export type {
  JenkinsBuildManagementState,
  JenkinsJobCollectionRequest,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JenkinsViewInfo,
  JobParameter,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions,
  PendingInputAction,
  PendingInputSummary
} from "./data/JenkinsDataTypes";
export { CancellationError } from "./errors";
export type { BuildListFetchOptions } from "./JenkinsDataServiceContracts";
export type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
} from "./types";

/**
 * Stable Jenkins data façade. Each method delegates to the operation object
 * that owns the corresponding Jenkins endpoints.
 */
export class JenkinsDataService
  implements
    JenkinsArtifactRetrievalRuntimeSurface,
    JenkinsBuildInspectionRuntimeSurface,
    JenkinsBuildManagementRuntimeSurface,
    JenkinsBuildRelationshipsRuntimeSurface,
    JenkinsCoverageRuntimeSurface,
    JenkinsJobStateRuntimeSurface,
    JenkinsPendingInputActionRuntimeSurface,
    JenkinsPipelineRestartRuntimeSurface
{
  private readonly runtimeContext: JenkinsDataRuntimeContext;
  private readonly jobIndex: JenkinsJobIndex;
  private readonly buildRelationships: JenkinsBuildRelationships;
  private readonly buildOperations: JenkinsBuildDataOperations;
  private readonly coverageOperations: JenkinsCoverageDataOperations;
  private readonly pendingInputOperations: JenkinsPendingInputDataOperations;
  private readonly nodeOperations: JenkinsNodeDataOperations;
  private readonly jobOperations: JenkinsJobDataOperations;
  private readonly queueAndJobManagementOperations: JenkinsQueueAndJobManagementOperations;

  constructor(clientProvider: JenkinsClientProvider, options: JenkinsDataServiceOptions) {
    this.runtimeContext = new JenkinsDataRuntimeContext(clientProvider, options);
    this.jobIndex = new JenkinsJobIndex(this.runtimeContext.getCache(), clientProvider, () =>
      this.runtimeContext.getCacheTtlMs()
    );
    this.buildOperations = new JenkinsBuildDataOperations(this.runtimeContext);
    this.buildRelationships = new JenkinsBuildRelationships(this.runtimeContext);
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

  updateCacheTtlMs(cacheTtlMs?: number): void {
    this.runtimeContext.setCacheTtlMs(cacheTtlMs);
  }

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    return this.jobOperations.getJob(environment, jobUrl);
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildFollowUpDependencies.dataService
  async getNextBuildNumber(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<number> {
    return this.jobOperations.getNextBuildNumber(environment, jobUrl);
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

  iterateJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): AsyncIterable<JobSearchEntry[]> {
    return this.jobIndex.iterateJobsForEnvironment(environment, options);
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
    options?: {
      includeCauses?: boolean;
      includeParameters?: boolean;
      statusOnly?: boolean;
      revisionsOnly?: boolean;
      bypassCache?: boolean;
    }
  ): Promise<JenkinsBuildDetails> {
    return this.buildOperations.getBuildDetails(environment, buildUrl, options);
  }

  async getDownstreamBuilds(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: DownstreamBuildSearchOptions
  ): Promise<DownstreamBuildSearchResult> {
    return this.buildRelationships.getDownstreamBuilds(environment, buildUrl, options);
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

  async getArtifactArchiveStream(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { maxBytes?: number; signal?: AbortSignal }
  ): Promise<JenkinsStreamResponse> {
    return this.buildOperations.getArtifactArchiveStream(environment, buildUrl, options);
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

  async getNodeConfiguration(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<NodeConfiguration> {
    return this.nodeOperations.getNodeConfiguration(environment, nodeUrl);
  }

  async updateNodeLabels(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    labels: string,
    expectedLabels: string
  ): Promise<NodeLabelsUpdateResult> {
    return this.nodeOperations.updateNodeLabels(environment, nodeUrl, labels, expectedLabels);
  }

  async disconnectNodeAgent(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    reason?: string
  ): Promise<{ status: "requested" | "no_change"; details: JenkinsNodeDetails }> {
    return this.nodeOperations.disconnectNodeAgent(environment, nodeUrl, reason);
  }

  async checkNodeDeletion(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string
  ): Promise<JenkinsNodeDetails> {
    return this.nodeOperations.checkNodeDeletion(environment, nodeUrl);
  }

  async deleteNode(environment: JenkinsEnvironmentRef, nodeUrl: string): Promise<void> {
    return this.nodeOperations.deleteNode(environment, nodeUrl);
  }

  async createNode(
    environment: JenkinsEnvironmentRef,
    input: NodeCreateInput
  ): Promise<NodeCreationResult> {
    return this.nodeOperations.createNode(environment, input);
  }

  async copyNode(
    environment: JenkinsEnvironmentRef,
    sourceUrl: string,
    name: string
  ): Promise<NodeCreationResult> {
    return this.nodeOperations.copyNode(environment, sourceUrl, name);
  }

  async getNodeAgentLog(
    environment: JenkinsEnvironmentRef,
    nodeUrl: string,
    options?: NodeAgentLogOptions
  ): Promise<NodeAgentLogResult> {
    return this.nodeOperations.getNodeAgentLog(environment, nodeUrl, options);
  }

  async getQueueItems(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]> {
    return this.queueAndJobManagementOperations.getQueueItems(environment);
  }

  // fallow-ignore-next-line unused-class-member -- invoked through QueuedBuildWaiter's injected data service
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

  async deleteBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { releaseKeep?: boolean }
  ): Promise<void> {
    return this.buildOperations.deleteBuild(environment, buildUrl, options);
  }

  async setBuildKeepForever(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    keep: boolean
  ): Promise<boolean> {
    return this.buildOperations.setBuildKeepForever(environment, buildUrl, keep);
  }

  async setBuildDescription(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    description: string
  ): Promise<void> {
    return this.buildOperations.setBuildDescription(environment, buildUrl, description);
  }

  async setBuildDisplayName(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    displayName: string
  ): Promise<void> {
    return this.buildOperations.setBuildDisplayName(environment, buildUrl, displayName);
  }

  async getBuildManagementState(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsBuildManagementState> {
    return this.buildOperations.getBuildManagementState(environment, buildUrl);
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
