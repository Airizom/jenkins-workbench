import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";
import type { PreparedBuildParametersRequest } from "../data/JenkinsDataTypes";
import { JenkinsRequestError } from "../errors";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../request";
import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsPendingInputAction,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload,
  JenkinsRestartFromStageInfo,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../types";
import { buildActionUrl, buildApiUrlFromItem, buildArtifactDownloadUrl } from "../urls";
import { JenkinsBuildConsoleClient } from "./JenkinsBuildConsoleClient";
import {
  buildBuildDetailsTree,
  buildBuildsTree,
  buildTestReportTree
} from "./JenkinsBuildTreeBuilders";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { JenkinsPendingInputClient } from "./JenkinsPendingInputClient";
import { JenkinsReplayClient } from "./JenkinsReplayClient";
import { RestartFromStageClient } from "./RestartFromStageClient";

export type JenkinsBuildTriggerMode = "build" | "buildWithParameters";

export type JenkinsBuildTriggerOptions =
  | { mode: "build" }
  | {
      mode: "buildWithParameters";
      prepared?: PreparedBuildParametersRequest;
      allowEmptyParams?: boolean;
    };

export class JenkinsBuildsApi {
  private readonly consoleClient: JenkinsBuildConsoleClient;
  private readonly pendingInputClient: JenkinsPendingInputClient;
  private readonly replayClient: JenkinsReplayClient;
  private readonly restartFromStageClient: RestartFromStageClient;

  constructor(private readonly context: JenkinsClientContext) {
    this.consoleClient = new JenkinsBuildConsoleClient(context);
    this.pendingInputClient = new JenkinsPendingInputClient(context);
    this.replayClient = new JenkinsReplayClient(context);
    this.restartFromStageClient = new RestartFromStageClient(context);
  }

  async getBuilds(
    jobUrl: string,
    limit = 20,
    options?: { includeDetails?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuild[]> {
    const end = Math.max(limit - 1, 0);
    const tree = buildBuildsTree(options).replace("{limit}", `{0,${end}}`);
    const url = buildApiUrlFromItem(jobUrl, tree);
    const response = await this.context.requestJson<{ builds?: JenkinsBuild[] }>(url);
    return Array.isArray(response.builds) ? response.builds : [];
  }

  async getBuildDetails(
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuildDetails> {
    const tree = buildBuildDetailsTree(options);
    const url = buildApiUrlFromItem(buildUrl, tree);
    return this.context.requestJson<JenkinsBuildDetails>(url);
  }

  async getBuildArtifacts(buildUrl: string): Promise<JenkinsArtifact[]> {
    const url = buildApiUrlFromItem(buildUrl, "artifacts[fileName,relativePath]");
    const response = await this.context.requestJson<{ artifacts?: JenkinsArtifact[] }>(url);
    return Array.isArray(response.artifacts) ? response.artifacts : [];
  }

  async getTestReport(
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport> {
    const url = new URL(buildActionUrl(buildUrl, "testReport/api/json"));
    url.searchParams.set("tree", buildTestReportTree(options));
    return this.context.requestJson<JenkinsTestReport>(url.toString());
  }

  async getWorkflowRun(buildUrl: string): Promise<JenkinsWorkflowRun> {
    const url = buildActionUrl(buildUrl, "wfapi/describe");
    return this.context.requestJson<JenkinsWorkflowRun>(url);
  }

  async getPendingInputActions(buildUrl: string): Promise<JenkinsPendingInputAction[]> {
    return this.pendingInputClient.getPendingInputActions(buildUrl);
  }

  async getArtifact(
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const url = buildArtifactDownloadUrl(buildUrl, relativePath);
    return this.context.requestBufferWithHeaders(url, options);
  }

  async getArtifactStream(
    buildUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    const url = buildArtifactDownloadUrl(buildUrl, relativePath);
    return this.context.requestStream(url, options);
  }

  async getConsoleText(buildUrl: string, maxChars?: number): Promise<JenkinsConsoleText> {
    return this.consoleClient.getConsoleText(buildUrl, maxChars);
  }

  async getConsoleTextHead(buildUrl: string, maxBytes: number): Promise<JenkinsConsoleText> {
    return this.consoleClient.getConsoleTextHead(buildUrl, maxBytes);
  }

  async getConsoleTextTail(buildUrl: string, maxChars: number): Promise<JenkinsConsoleTextTail> {
    return this.consoleClient.getConsoleTextTail(buildUrl, maxChars);
  }

  async getConsoleTextProgressive(
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<JenkinsProgressiveConsoleText> {
    return this.consoleClient.getConsoleTextProgressive(buildUrl, start, maxBytes);
  }

  async getConsoleHtmlProgressive(
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml> {
    return this.consoleClient.getConsoleHtmlProgressive(buildUrl, start, annotator);
  }

  async getLastFailedBuild(jobUrl: string): Promise<JenkinsBuild | undefined> {
    const tree = "lastFailedBuild[number,url,result,building,timestamp,duration]";
    const url = buildApiUrlFromItem(jobUrl, tree);
    const response = await this.context.requestJson<{
      lastFailedBuild?: JenkinsBuild | null;
    }>(url);
    return response.lastFailedBuild ?? undefined;
  }

  async triggerBuild(
    jobUrl: string,
    options: JenkinsBuildTriggerOptions
  ): Promise<{ queueLocation?: string }> {
    if (options.mode === "buildWithParameters") {
      const prepared = options.prepared ?? { hasParameters: false };
      const hasParams = prepared.hasParameters;
      const allowEmptyParams = options.allowEmptyParams === true;
      if (!hasParams && !allowEmptyParams) {
        const fallbackUrl = buildActionUrl(jobUrl, "build");
        const fallbackResponse = await this.context.requestPostWithCrumb(fallbackUrl);
        return { queueLocation: fallbackResponse.location };
      }
      const url = buildActionUrl(jobUrl, "buildWithParameters");
      const request = prepared.request;
      try {
        const response = request
          ? await this.context.requestPostWithCrumbRaw(url, request.body, request.headers)
          : await this.context.requestPostWithCrumb(url);
        return { queueLocation: response.location };
      } catch (error) {
        if (allowEmptyParams && !hasParams && error instanceof JenkinsRequestError) {
          if (error.statusCode === 400 || error.statusCode === 404) {
            const fallbackUrl = buildActionUrl(jobUrl, "build");
            const fallbackResponse = await this.context.requestPostWithCrumb(fallbackUrl);
            return { queueLocation: fallbackResponse.location };
          }
        }
        throw error;
      }
    }
    const url = buildActionUrl(jobUrl, "build");
    const response = await this.context.requestPostWithCrumb(url);
    return { queueLocation: response.location };
  }

  async stopBuild(buildUrl: string): Promise<void> {
    const url = buildActionUrl(buildUrl, "stop");
    await this.context.requestVoidWithCrumb(url);
  }

  async quickReplayBuild(buildUrl: string): Promise<void> {
    const url = buildActionUrl(buildUrl, "replay/rebuild");
    await this.context.requestVoidWithCrumb(url);
  }

  async getReplayDefinition(buildUrl: string): Promise<JenkinsReplayDefinition> {
    return this.replayClient.getReplayDefinition(buildUrl);
  }

  async runReplay(
    buildUrl: string,
    payload: JenkinsReplaySubmissionPayload
  ): Promise<JenkinsReplayResult> {
    return this.replayClient.runReplay(buildUrl, payload);
  }

  async rebuildBuild(buildUrl: string): Promise<void> {
    // The rebuild plugin expects a trailing slash for POSTs and supports the
    // `autorebuild` parameter to bypass the parameter entry page.
    const url = buildActionUrl(buildUrl, "rebuild/");
    const body = new URLSearchParams({ autorebuild: "true" }).toString();
    await this.context.requestVoidWithCrumb(url, body);
  }

  async getRestartFromStageInfo(buildUrl: string): Promise<JenkinsRestartFromStageInfo> {
    return this.restartFromStageClient.getRestartFromStageInfo(buildUrl);
  }

  async restartPipelineFromStage(buildUrl: string, stageName: string): Promise<void> {
    await this.restartFromStageClient.restartPipelineFromStage(buildUrl, stageName);
  }

  async proceedInput(
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    await this.pendingInputClient.proceedInput(buildUrl, inputId, options);
  }

  async abortInput(buildUrl: string, inputId: string, abortUrl?: string): Promise<void> {
    await this.pendingInputClient.abortInput(buildUrl, inputId, abortUrl);
  }
}
