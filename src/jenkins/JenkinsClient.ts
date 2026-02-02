import type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";
import { JenkinsBuildsApi } from "./client/JenkinsBuildsApi";
import type { JenkinsBuildTriggerOptions } from "./client/JenkinsBuildsApi";
import { JenkinsHttpClient } from "./client/JenkinsHttpClient";
import { JenkinsJobsApi } from "./client/JenkinsJobsApi";
import { JenkinsNodesApi } from "./client/JenkinsNodesApi";
import { JenkinsPipelineValidationApi } from "./client/JenkinsPipelineValidationApi";
import { JenkinsQueueApi } from "./client/JenkinsQueueApi";
import { JenkinsRequestError } from "./errors";
import type { JenkinsBufferResponse } from "./request";
import type { JenkinsStreamResponse } from "./request";
import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsClientOptions,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsNodeDetails,
  JenkinsParameterDefinition,
  JenkinsPendingInputAction,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsQueueItem,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "./types";

export type {
  JenkinsBuild,
  JenkinsBuildAction,
  JenkinsBuildCause,
  JenkinsBuildParameter,
  JenkinsBuildDetails,
  JenkinsArtifact,
  JenkinsClientOptions,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsChangeSet,
  JenkinsChangeSetItem,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsNodeDetails,
  JenkinsNodeExecutable,
  JenkinsNodeExecutor,
  JenkinsNodeOfflineCause,
  JenkinsPendingInputAction,
  JenkinsPendingInputParameterDefinition,
  JenkinsParameterDefinition,
  JenkinsProgressiveConsoleHtml,
  JenkinsQueueItem,
  JenkinsProgressiveConsoleText,
  JenkinsTestReport,
  JenkinsTestSummaryAction,
  JenkinsWorkflowRun
} from "./types";

export type {
  JenkinsBuildTriggerMode,
  JenkinsBuildTriggerOptions
} from "./client/JenkinsBuildsApi";
export type { JenkinsTestReportOptions } from "./JenkinsTestReportOptions";

export { JenkinsRequestError };

export class JenkinsClient {
  private readonly buildsApi: JenkinsBuildsApi;
  private readonly jobsApi: JenkinsJobsApi;
  private readonly nodesApi: JenkinsNodesApi;
  private readonly queueApi: JenkinsQueueApi;
  private readonly pipelineValidationApi: JenkinsPipelineValidationApi;

  constructor(options: JenkinsClientOptions) {
    const httpClient = new JenkinsHttpClient(options);
    this.jobsApi = new JenkinsJobsApi(httpClient);
    this.buildsApi = new JenkinsBuildsApi(httpClient);
    this.nodesApi = new JenkinsNodesApi(httpClient);
    this.queueApi = new JenkinsQueueApi(httpClient);
    this.pipelineValidationApi = new JenkinsPipelineValidationApi(httpClient);
  }

  async getRootJobs(): Promise<JenkinsJob[]> {
    return this.jobsApi.getRootJobs();
  }

  async getFolderJobs(folderUrl: string): Promise<JenkinsJob[]> {
    return this.jobsApi.getFolderJobs(folderUrl);
  }

  async getJob(jobUrl: string): Promise<JenkinsJob> {
    return this.jobsApi.getJob(jobUrl);
  }

  async getBuilds(
    jobUrl: string,
    limit = 20,
    options?: { includeDetails?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuild[]> {
    return this.buildsApi.getBuilds(jobUrl, limit, options);
  }

  async getBuildDetails(
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuildDetails> {
    return this.buildsApi.getBuildDetails(buildUrl, options);
  }

  async getBuildArtifacts(buildUrl: string): Promise<JenkinsArtifact[]> {
    return this.buildsApi.getBuildArtifacts(buildUrl);
  }

  async getConsoleText(buildUrl: string, maxChars?: number): Promise<JenkinsConsoleText> {
    return this.buildsApi.getConsoleText(buildUrl, maxChars);
  }

  async getConsoleTextTail(buildUrl: string, maxChars: number): Promise<JenkinsConsoleTextTail> {
    return this.buildsApi.getConsoleTextTail(buildUrl, maxChars);
  }

  async getConsoleTextProgressive(
    buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText> {
    return this.buildsApi.getConsoleTextProgressive(buildUrl, start);
  }

  async getConsoleHtmlProgressive(
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml> {
    return this.buildsApi.getConsoleHtmlProgressive(buildUrl, start, annotator);
  }

  async getLastFailedBuild(jobUrl: string): Promise<JenkinsBuild | undefined> {
    return this.buildsApi.getLastFailedBuild(jobUrl);
  }

  async getTestReport(
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport> {
    return this.buildsApi.getTestReport(buildUrl, options);
  }

  async getWorkflowRun(buildUrl: string): Promise<JenkinsWorkflowRun> {
    return this.buildsApi.getWorkflowRun(buildUrl);
  }

  async getPendingInputActions(buildUrl: string): Promise<JenkinsPendingInputAction[]> {
    return this.buildsApi.getPendingInputActions(buildUrl);
  }

  async getArtifact(
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.buildsApi.getArtifact(buildUrl, relativePath, options);
  }

  async getArtifactStream(
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.buildsApi.getArtifactStream(buildUrl, relativePath, options);
  }

  async getNodes(): Promise<JenkinsNode[]> {
    return this.nodesApi.getNodes();
  }

  async getNodeDetails(
    nodeUrl: string,
    options?: { detailLevel?: "basic" | "advanced" }
  ): Promise<JenkinsNodeDetails> {
    return this.nodesApi.getNodeDetails(nodeUrl, options);
  }

  async toggleNodeTemporarilyOffline(nodeUrl: string, offlineMessage?: string): Promise<void> {
    await this.nodesApi.toggleNodeTemporarilyOffline(nodeUrl, offlineMessage);
  }

  async launchNodeAgent(nodeUrl: string): Promise<void> {
    await this.nodesApi.launchNodeAgent(nodeUrl);
  }

  async getQueue(): Promise<JenkinsQueueItem[]> {
    return this.queueApi.getQueue();
  }

  async getQueueItem(id: number): Promise<JenkinsQueueItem> {
    return this.queueApi.getQueueItem(id);
  }

  classifyJob(job: JenkinsJob): JenkinsJobKind {
    return this.jobsApi.classifyJob(job);
  }

  async triggerBuild(
    jobUrl: string,
    options: JenkinsBuildTriggerOptions
  ): Promise<{ queueLocation?: string }> {
    return this.buildsApi.triggerBuild(jobUrl, options);
  }

  async stopBuild(buildUrl: string): Promise<void> {
    await this.buildsApi.stopBuild(buildUrl);
  }

  async replayBuild(buildUrl: string): Promise<void> {
    await this.buildsApi.replayBuild(buildUrl);
  }

  async rebuildBuild(buildUrl: string): Promise<void> {
    await this.buildsApi.rebuildBuild(buildUrl);
  }

  async proceedInput(
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    await this.buildsApi.proceedInput(buildUrl, inputId, options);
  }

  async abortInput(buildUrl: string, inputId: string, abortUrl?: string): Promise<void> {
    await this.buildsApi.abortInput(buildUrl, inputId, abortUrl);
  }

  async getJobParameters(jobUrl: string): Promise<JenkinsParameterDefinition[]> {
    return this.jobsApi.getJobParameters(jobUrl);
  }

  async getJobConfigXml(jobUrl: string): Promise<string> {
    return this.jobsApi.getJobConfigXml(jobUrl);
  }

  async updateJobConfigXml(jobUrl: string, xml: string): Promise<void> {
    await this.jobsApi.updateJobConfigXml(jobUrl, xml);
  }

  async cancelQueueItem(id: number): Promise<void> {
    await this.queueApi.cancelQueueItem(id);
  }

  async enableJob(jobUrl: string): Promise<void> {
    await this.jobsApi.enableJob(jobUrl);
  }

  async disableJob(jobUrl: string): Promise<void> {
    await this.jobsApi.disableJob(jobUrl);
  }

  async renameJob(jobUrl: string, newName: string): Promise<{ newUrl: string }> {
    return this.jobsApi.renameJob(jobUrl, newName);
  }

  async deleteJob(jobUrl: string): Promise<void> {
    await this.jobsApi.deleteJob(jobUrl);
  }

  async copyJob(
    parentUrl: string,
    sourceName: string,
    newName: string
  ): Promise<{ newUrl: string }> {
    return this.jobsApi.copyJob(parentUrl, sourceName, newName);
  }

  async validateDeclarativeJenkinsfile(jenkinsfileText: string): Promise<string> {
    return this.pipelineValidationApi.validateDeclarative(jenkinsfileText);
  }
}
