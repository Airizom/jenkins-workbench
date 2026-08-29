import type { BuildParameterPayload } from "./BuildParameterRequests";
import type { JenkinsQueueItemInfo, JobParameter } from "./data/JenkinsDataTypes";
import type {
  JenkinsItemCreateKind,
  JenkinsQueueItem,
  JenkinsRestartFromStageInfo,
  ScanMultibranchResult
} from "./JenkinsClient";
import { JenkinsDataServiceReader } from "./JenkinsDataServiceReader";
import type {
  JenkinsArtifactRetrievalRuntimeSurface,
  JenkinsBuildInspectionRuntimeSurface,
  JenkinsCoverageRuntimeSurface,
  JenkinsJobStateRuntimeSurface,
  JenkinsPendingInputActionRuntimeSurface,
  JenkinsPipelineRestartRuntimeSurface
} from "./JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
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
  BuildListFetchOptions,
  JenkinsDataServiceOptions
} from "./JenkinsDataServiceContracts";
export type {
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload
} from "./types";

/**
 * Stable Jenkins data façade. Read-oriented operations live on the base class;
 * build, queue, and job mutations remain here to keep command-side behavior
 * easy to audit.
 */
export class JenkinsDataService
  extends JenkinsDataServiceReader
  implements
    JenkinsArtifactRetrievalRuntimeSurface,
    JenkinsBuildInspectionRuntimeSurface,
    JenkinsCoverageRuntimeSurface,
    JenkinsPendingInputActionRuntimeSurface,
    JenkinsPipelineRestartRuntimeSurface,
    JenkinsJobStateRuntimeSurface
{
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
