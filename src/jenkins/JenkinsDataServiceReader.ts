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
  JenkinsViewInfo,
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
  JenkinsJob,
  JenkinsNodeDetails,
  JenkinsWorkflowRun,
  JenkinsWorkspaceEntry
} from "./JenkinsClient";
import type { JenkinsClientProvider } from "./JenkinsClientProvider";
import type {
  BuildListFetchOptions,
  JenkinsDataServiceOptions
} from "./JenkinsDataServiceContracts";
import type {
  JenkinsArtifactRetrievalRuntimeSurface,
  JenkinsBuildInspectionRuntimeSurface,
  JenkinsCoverageRuntimeSurface,
  JenkinsPendingInputActionRuntimeSurface
} from "./JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import type { JenkinsTestReport } from "./types";

/**
 * Read-oriented and pending-input portion of the Jenkins data façade. The
 * concrete service adds build and job mutation methods while inheriting this
 * stable surface.
 */
export class JenkinsDataServiceReader
  implements
    JenkinsArtifactRetrievalRuntimeSurface,
    JenkinsBuildInspectionRuntimeSurface,
    JenkinsCoverageRuntimeSurface,
    JenkinsPendingInputActionRuntimeSurface
{
  private readonly runtimeContext: JenkinsDataRuntimeContext;
  private readonly jobIndex: JenkinsJobIndex;
  protected readonly buildOperations: JenkinsBuildDataOperations;
  private readonly coverageOperations: JenkinsCoverageDataOperations;
  private readonly pendingInputOperations: JenkinsPendingInputDataOperations;
  private readonly nodeOperations: JenkinsNodeDataOperations;
  protected readonly jobOperations: JenkinsJobDataOperations;
  protected readonly queueAndJobManagementOperations: JenkinsQueueAndJobManagementOperations;

  constructor(clientProvider: JenkinsClientProvider, options: JenkinsDataServiceOptions) {
    this.runtimeContext = new JenkinsDataRuntimeContext(clientProvider, options);
    this.jobIndex = new JenkinsJobIndex(this.runtimeContext.getCache(), clientProvider, () =>
      this.runtimeContext.getCacheTtlMs()
    );
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
}
