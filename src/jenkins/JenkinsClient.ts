import { JenkinsBuildsApi } from "./client/JenkinsBuildsApi";
import { JenkinsHttpClient } from "./client/JenkinsHttpClient";
import { JenkinsJobsApi } from "./client/JenkinsJobsApi";
import { JenkinsNodesApi } from "./client/JenkinsNodesApi";
import { JenkinsQueueApi } from "./client/JenkinsQueueApi";
import { JenkinsRequestError } from "./errors";
import type {
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsClientOptions,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsParameterDefinition,
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
  JenkinsClientOptions,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsChangeSet,
  JenkinsChangeSetItem,
  JenkinsJob,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsParameterDefinition,
  JenkinsQueueItem,
  JenkinsProgressiveConsoleText,
  JenkinsTestReport,
  JenkinsTestSummaryAction,
  JenkinsWorkflowRun
} from "./types";

export { JenkinsRequestError };

export class JenkinsClient {
  private readonly buildsApi: JenkinsBuildsApi;
  private readonly jobsApi: JenkinsJobsApi;
  private readonly nodesApi: JenkinsNodesApi;
  private readonly queueApi: JenkinsQueueApi;

  constructor(options: JenkinsClientOptions) {
    const httpClient = new JenkinsHttpClient(options);
    this.jobsApi = new JenkinsJobsApi(httpClient);
    this.buildsApi = new JenkinsBuildsApi(httpClient);
    this.nodesApi = new JenkinsNodesApi(httpClient);
    this.queueApi = new JenkinsQueueApi(httpClient);
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

  async getLastFailedBuild(jobUrl: string): Promise<JenkinsBuild | undefined> {
    return this.buildsApi.getLastFailedBuild(jobUrl);
  }

  async getTestReport(buildUrl: string): Promise<JenkinsTestReport> {
    return this.buildsApi.getTestReport(buildUrl);
  }

  async getWorkflowRun(buildUrl: string): Promise<JenkinsWorkflowRun> {
    return this.buildsApi.getWorkflowRun(buildUrl);
  }

  async getNodes(): Promise<JenkinsNode[]> {
    return this.nodesApi.getNodes();
  }

  async getQueue(): Promise<JenkinsQueueItem[]> {
    return this.queueApi.getQueue();
  }

  classifyJob(job: JenkinsJob): JenkinsJobKind {
    return this.jobsApi.classifyJob(job);
  }

  async triggerBuild(
    jobUrl: string,
    params?: URLSearchParams
  ): Promise<{ queueLocation?: string }> {
    return this.buildsApi.triggerBuild(jobUrl, params);
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

  async getJobParameters(jobUrl: string): Promise<JenkinsParameterDefinition[]> {
    return this.jobsApi.getJobParameters(jobUrl);
  }

  async cancelQueueItem(id: number): Promise<void> {
    await this.queueApi.cancelQueueItem(id);
  }
}
