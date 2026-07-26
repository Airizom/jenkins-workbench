import type { PreparedBuildParametersRequest } from "../BuildParameterRequests";
import { JenkinsRequestError } from "../errors";
import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../request";
import type {
  JenkinsArtifact,
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsFlowNodeLog,
  JenkinsPendingInputAction,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsReplayDefinition,
  JenkinsReplayResult,
  JenkinsReplaySubmissionPayload,
  JenkinsRestartFromStageInfo,
  JenkinsTestReport,
  JenkinsWorkflowRun,
  JenkinsWorkflowStage
} from "../types";
import {
  buildActionUrl,
  buildApiUrlFromItem,
  buildArtifactDownloadUrl,
  ensureTrailingSlash
} from "../urls";
import { JenkinsBuildConsoleClient } from "./JenkinsBuildConsoleClient";
import {
  buildBuildDetailsTree,
  buildBuildsTree,
  buildTestReportTree
} from "./JenkinsBuildTreeBuilders";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { buildProgressiveConsoleHtmlResult } from "./JenkinsConsoleStream";
import { JenkinsPendingInputClient } from "./JenkinsPendingInputClient";
import { JenkinsReplayClient } from "./JenkinsReplayClient";
import { resolveTrustedJenkinsUrl } from "./JenkinsTrustedUrl";
import { RestartFromStageClient } from "./RestartFromStageClient";

const BUILD_ARTIFACTS_TREE = "artifacts[fileName,relativePath]";
const LAST_FAILED_BUILD_TREE = "lastFailedBuild[number,url,result,building,timestamp,duration]";
const REBUILD_AUTOREBUILD_BODY = "autorebuild=true";
const BUILD_LIST_LIMIT_TOKEN = "{limit}";

const BUILD_LIST_TREE_PREFIXES = [
  buildBuildsTree(),
  buildBuildsTree({ includeDetails: true }),
  buildBuildsTree({ includeParameters: true }),
  buildBuildsTree({ includeDetails: true, includeParameters: true })
].map((tree) => tree.slice(0, -BUILD_LIST_LIMIT_TOKEN.length));

const BUILD_DETAILS_TREE_TEMPLATES = [
  buildBuildDetailsTree(),
  buildBuildDetailsTree({ includeCauses: true }),
  buildBuildDetailsTree({ includeParameters: true }),
  buildBuildDetailsTree({ includeCauses: true, includeParameters: true })
];
const BUILD_STATUS_TREE = buildBuildDetailsTree({ statusOnly: true });

const TEST_REPORT_TREES = [buildTestReportTree(), buildTestReportTree({ includeCaseLogs: true })];

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
    const safeLimit = Math.floor(limit);
    if (safeLimit <= 0) {
      return [];
    }
    // Stapler tree ranges {M,N} are exclusive of N, so {0,limit} returns `limit` builds.
    const tree = `${getBuildsTreePrefix(options)}{0,${safeLimit}}`;
    const url = buildApiUrlFromItem(jobUrl, tree);
    const response = await this.context.requestJson<{ builds?: JenkinsBuild[] }>(url);
    return Array.isArray(response.builds) ? response.builds : [];
  }

  async getBuildDetails(
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean; statusOnly?: boolean }
  ): Promise<JenkinsBuildDetails> {
    const tree = getBuildDetailsTree(options);
    const url = buildApiUrlFromItem(buildUrl, tree);
    return this.context.requestJson<JenkinsBuildDetails>(url);
  }

  async getBuildArtifacts(buildUrl: string): Promise<JenkinsArtifact[]> {
    const url = buildApiUrlFromItem(buildUrl, BUILD_ARTIFACTS_TREE);
    const response = await this.context.requestJson<{ artifacts?: JenkinsArtifact[] }>(url);
    return Array.isArray(response.artifacts) ? response.artifacts : [];
  }

  async getTestReport(
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport> {
    const url = new URL("testReport/api/json", ensureTrailingSlash(buildUrl));
    url.searchParams.set("tree", getTestReportTree(options));
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

  async getFlowNodeLog(buildUrl: string, nodeId: string): Promise<JenkinsFlowNodeLog> {
    const url = this.buildFlowNodeLogUrl(buildUrl, nodeId);
    const snapshot = await this.context.requestJson<JenkinsFlowNodeLog>(url);
    return {
      ...snapshot,
      consoleUrl: this.resolveTrustedFlowNodeConsoleUrl(buildUrl, snapshot.consoleUrl)
    };
  }

  async getFlowNodeDetails(buildUrl: string, nodeId: string): Promise<JenkinsWorkflowStage> {
    const url = this.buildFlowNodeDescribeUrl(buildUrl, nodeId);
    return this.context.requestJson<JenkinsWorkflowStage>(url);
  }

  async getFlowNodeLogHtmlProgressive(
    buildUrl: string,
    nodeId: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml> {
    const consoleUrl = await this.resolveFlowNodeLogConsoleUrl(buildUrl, nodeId);
    if (!consoleUrl) {
      throw new JenkinsRequestError("Flow node console URL is unavailable.", 404);
    }
    const safeStart = Math.max(0, Math.floor(start));
    const url = new URL("logText/progressiveHtml", ensureTrailingSlash(consoleUrl));
    url.searchParams.set("start", safeStart.toString());
    const response = await this.context.requestTextWithHeaders(url.toString(), {
      headers: annotator ? { "X-ConsoleAnnotator": annotator } : undefined
    });
    return buildProgressiveConsoleHtmlResult(response, safeStart);
  }

  async getLastFailedBuild(jobUrl: string): Promise<JenkinsBuild | undefined> {
    const url = buildApiUrlFromItem(jobUrl, LAST_FAILED_BUILD_TREE);
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
        return this.triggerParameterlessBuild(jobUrl);
      }
      const url = buildActionUrl(jobUrl, "buildWithParameters");
      const request = prepared.request;
      try {
        const response = request
          ? await this.context.requestPostWithCrumbRaw(url, request.body, request.headers)
          : await this.context.requestPostWithCrumb(url);
        return { queueLocation: response.location };
      } catch (error) {
        if (
          allowEmptyParams &&
          !hasParams &&
          error instanceof JenkinsRequestError &&
          (error.statusCode === 400 || error.statusCode === 404)
        ) {
          return this.triggerParameterlessBuild(jobUrl);
        }
        throw error;
      }
    }
    return this.triggerParameterlessBuild(jobUrl);
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
    await this.context.requestVoidWithCrumb(url, REBUILD_AUTOREBUILD_BODY);
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

  private async triggerParameterlessBuild(jobUrl: string): Promise<{ queueLocation?: string }> {
    const url = buildActionUrl(jobUrl, "build");
    const response = await this.context.requestPostWithCrumb(url);
    return { queueLocation: response.location };
  }

  private buildFlowNodeLogUrl(buildUrl: string, nodeId: string): string {
    return buildActionUrl(
      buildUrl,
      `execution/node/${encodeURIComponent(nodeId.trim())}/wfapi/log`
    );
  }

  private buildFlowNodeDescribeUrl(buildUrl: string, nodeId: string): string {
    return buildActionUrl(
      buildUrl,
      `execution/node/${encodeURIComponent(nodeId.trim())}/wfapi/describe`
    );
  }

  private async resolveFlowNodeLogConsoleUrl(
    buildUrl: string,
    nodeId: string
  ): Promise<string | undefined> {
    const url = this.buildFlowNodeLogUrl(buildUrl, nodeId);
    const snapshot = await this.context.requestJson<Pick<JenkinsFlowNodeLog, "consoleUrl">>(url);
    return this.resolveTrustedFlowNodeConsoleUrl(buildUrl, snapshot.consoleUrl);
  }

  private resolveTrustedFlowNodeConsoleUrl(
    buildUrl: string,
    consoleUrl: string | undefined
  ): string | undefined {
    return consoleUrl
      ? resolveTrustedJenkinsUrl(this.context.baseUrl, consoleUrl, ensureTrailingSlash(buildUrl))
      : undefined;
  }
}

function getBuildsTreePrefix(options?: {
  includeDetails?: boolean;
  includeParameters?: boolean;
}): string {
  const key = getBooleanOptionKey(options?.includeDetails, options?.includeParameters);
  return BUILD_LIST_TREE_PREFIXES[key];
}

function getBuildDetailsTree(options?: {
  includeCauses?: boolean;
  includeParameters?: boolean;
  statusOnly?: boolean;
}): string {
  if (options?.statusOnly) {
    return BUILD_STATUS_TREE;
  }
  const key = getBooleanOptionKey(options?.includeCauses, options?.includeParameters);
  return BUILD_DETAILS_TREE_TEMPLATES[key];
}

function getTestReportTree(options?: JenkinsTestReportOptions): string {
  return TEST_REPORT_TREES[options?.includeCaseLogs ? 1 : 0];
}

function getBooleanOptionKey(first?: boolean, second?: boolean): number {
  return (first ? 1 : 0) | (second ? 2 : 0);
}
