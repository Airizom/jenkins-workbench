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
  ScanMultibranchResult
} from "./JenkinsClient";
import type { JenkinsClientProvider } from "./JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import { JenkinsBuildDataOperations } from "./data/JenkinsBuildDataOperations";
import { JenkinsDataRuntimeContext } from "./data/JenkinsDataRuntimeContext";
import type {
  BuildParameterPayload,
  BuildParameterRequestPreparer,
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
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
import { JenkinsNodeDataOperations } from "./data/JenkinsNodeDataOperations";
import type { NodeLaunchResult, NodeOfflineToggleResult } from "./data/JenkinsNodeDataOperations";
import { JenkinsPendingInputDataOperations } from "./data/JenkinsPendingInputDataOperations";
import { JenkinsQueueAndJobManagementOperations } from "./data/JenkinsQueueAndJobManagementOperations";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "./request";
import type { JenkinsTestReport } from "./types";

export type {
  BuildActionErrorCode,
  BuildParameterPayload,
  CancellationChecker,
  CancellationInput,
  CancellationSignal,
  ConsoleTextResult,
  ConsoleTextTailResult,
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo,
  JobParameter,
  JobParameterKind,
  PendingInputAction,
  PendingInputSummary,
  ProgressiveConsoleHtmlResult,
  ProgressiveConsoleTextResult,
  JobPathSegment,
  JobSearchEntry,
  JobSearchOptions
} from "./data/JenkinsDataTypes";
export { BuildActionError, CancellationError, JobManagementActionError } from "./errors";

export interface JenkinsDataServiceOptions {
  buildParameterRequestPreparer: BuildParameterRequestPreparer;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

export interface BuildListFetchOptions {
  detailLevel?: "summary" | "details";
  includeParameters?: boolean;
}

export class JenkinsDataService {
  private readonly runtimeContext: JenkinsDataRuntimeContext;
  private readonly jobIndex: JenkinsJobIndex;
  private readonly buildOperations: JenkinsBuildDataOperations;
  private readonly pendingInputOperations: JenkinsPendingInputDataOperations;
  private readonly nodeOperations: JenkinsNodeDataOperations;
  private readonly jobOperations: JenkinsJobDataOperations;
  private readonly queueAndJobManagementOperations: JenkinsQueueAndJobManagementOperations;

  constructor(clientProvider: JenkinsClientProvider, options: JenkinsDataServiceOptions) {
    this.runtimeContext = new JenkinsDataRuntimeContext(clientProvider, options);
    this.jobIndex = new JenkinsJobIndex(this.runtimeContext.getCache(), clientProvider);
    this.buildOperations = new JenkinsBuildDataOperations(this.runtimeContext);
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

  async getJobsForEnvironment(environment: JenkinsEnvironmentRef): Promise<JenkinsJobInfo[]> {
    return this.jobOperations.getJobsForEnvironment(environment);
  }

  async getJob(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<JenkinsJob> {
    return this.jobOperations.getJob(environment, jobUrl);
  }

  async getJobsForFolder(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<JenkinsJobInfo[]> {
    return this.jobOperations.getJobsForFolder(environment, folderUrl);
  }

  async getAllJobsForEnvironment(
    environment: JenkinsEnvironmentRef,
    options?: JobSearchOptions
  ): Promise<JobSearchEntry[]> {
    return this.jobIndex.getAllJobsForEnvironment(environment, options);
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
    buildUrl: string
  ): Promise<JenkinsBuildDetails> {
    return this.buildOperations.getBuildDetails(environment, buildUrl);
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

  async getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<ConsoleTextResult> {
    return this.buildOperations.getConsoleText(environment, buildUrl, maxChars);
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
    start: number
  ): Promise<ProgressiveConsoleTextResult> {
    return this.buildOperations.getConsoleTextProgressive(environment, buildUrl, start);
  }

  async getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<ProgressiveConsoleHtmlResult> {
    return this.buildOperations.getConsoleHtmlProgressive(environment, buildUrl, start, annotator);
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

  async getNodes(environment: JenkinsEnvironmentRef): Promise<JenkinsNodeInfo[]> {
    return this.nodeOperations.getNodes(environment);
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

  async replayBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void> {
    return this.buildOperations.replayBuild(environment, buildUrl);
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
