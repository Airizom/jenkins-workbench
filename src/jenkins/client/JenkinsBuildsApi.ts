import type { JenkinsTestReportOptions } from "../JenkinsTestReportOptions";
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
  JenkinsRestartFromStageInfo,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../types";
import { buildActionUrl, buildApiUrlFromItem, buildArtifactDownloadUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { RestartFromStageClient } from "./RestartFromStageClient";

export type JenkinsBuildTriggerMode = "build" | "buildWithParameters";

export type JenkinsBuildTriggerOptions =
  | { mode: "build" }
  | {
      mode: "buildWithParameters";
      params?: URLSearchParams;
      allowEmptyParams?: boolean;
    };

export class JenkinsBuildsApi {
  private readonly restartFromStageClient: RestartFromStageClient;

  constructor(private readonly context: JenkinsClientContext) {
    this.restartFromStageClient = new RestartFromStageClient(context);
  }

  async getBuilds(
    jobUrl: string,
    limit = 20,
    options?: { includeDetails?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuild[]> {
    const end = Math.max(limit - 1, 0);
    const tree = this.buildBuildsTree(options).replace("{limit}", `{0,${end}}`);
    const url = buildApiUrlFromItem(jobUrl, tree);
    const response = await this.context.requestJson<{ builds?: JenkinsBuild[] }>(url);
    return Array.isArray(response.builds) ? response.builds : [];
  }

  async getBuildDetails(
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean }
  ): Promise<JenkinsBuildDetails> {
    const tree = this.buildBuildDetailsTree(options);
    const url = buildApiUrlFromItem(buildUrl, tree);
    return this.context.requestJson<JenkinsBuildDetails>(url);
  }

  async getBuildArtifacts(buildUrl: string): Promise<JenkinsArtifact[]> {
    const url = buildApiUrlFromItem(buildUrl, "artifacts[fileName,relativePath]");
    const response = await this.context.requestJson<{ artifacts?: JenkinsArtifact[] }>(url);
    return Array.isArray(response.artifacts) ? response.artifacts : [];
  }

  private buildBuildsTree(options?: {
    includeDetails?: boolean;
    includeParameters?: boolean;
  }): string {
    const parts: string[] = [
      "builds[",
      "number,url,result,building,timestamp,duration,estimatedDuration"
    ];

    if (options?.includeDetails) {
      parts.push(",changeSet[items[commitId,msg,author[fullName]]]");
      parts.push(",changeSets[items[commitId,msg,author[fullName]]]");
    }

    const includeCauses = Boolean(options?.includeDetails);
    const includeParameters = Boolean(options?.includeParameters);
    if (includeCauses || includeParameters) {
      const actionParts = ["_class"];
      if (includeCauses) {
        actionParts.push("causes[shortDescription,userId,userName]");
      }
      if (includeParameters) {
        actionParts.push("parameters[name,value]");
      }
      parts.push(`,actions[${actionParts.join(",")}]`);
    }

    parts.push("]{limit}");
    return parts.join("");
  }

  private buildBuildDetailsTree(options?: {
    includeCauses?: boolean;
    includeParameters?: boolean;
  }): string {
    const actionParts = ["_class", "failCount", "skipCount", "totalCount"];
    if (options?.includeCauses) {
      actionParts.push("causes[shortDescription,userId,userName]");
    }
    if (options?.includeParameters) {
      actionParts.push("parameters[name,value]");
    }
    return [
      "number,url,result,building,timestamp,duration,estimatedDuration,",
      "displayName,fullDisplayName,culprits[fullName],",
      "artifacts[fileName,relativePath],",
      "changeSet[items[commitId,msg,author[fullName]]],",
      "changeSets[items[commitId,msg,author[fullName]]],",
      `actions[${actionParts.join(",")}]`
    ].join("");
  }

  async getTestReport(
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport> {
    const url = new URL(buildActionUrl(buildUrl, "testReport/api/json"));
    const caseFields = ["name", "className", "status", "errorDetails", "duration"];
    if (options?.includeCaseLogs) {
      caseFields.push("errorStackTrace", "stdout", "stderr");
    }
    url.searchParams.set(
      "tree",
      `failCount,skipCount,totalCount,suites[cases[${caseFields.join(",")}]]`
    );
    return this.context.requestJson<JenkinsTestReport>(url.toString());
  }

  async getWorkflowRun(buildUrl: string): Promise<JenkinsWorkflowRun> {
    const url = buildActionUrl(buildUrl, "wfapi/describe");
    return this.context.requestJson<JenkinsWorkflowRun>(url);
  }

  async getPendingInputActions(buildUrl: string): Promise<JenkinsPendingInputAction[]> {
    const url = buildActionUrl(buildUrl, "wfapi/pendingInputActions");
    const response = await this.context.requestJson<unknown>(url);
    if (Array.isArray(response)) {
      return response as JenkinsPendingInputAction[];
    }
    if (response && typeof response === "object") {
      const candidate = response as {
        pendingInputActions?: unknown;
        actions?: unknown;
        inputs?: unknown;
      };
      const actions =
        candidate.pendingInputActions ?? candidate.actions ?? candidate.inputs ?? undefined;
      if (Array.isArray(actions)) {
        return actions as JenkinsPendingInputAction[];
      }
    }
    return [];
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
    if (maxChars === undefined || maxChars <= 0) {
      const url = buildActionUrl(buildUrl, "consoleText");
      const text = await this.context.requestText(url);
      return { text, truncated: false };
    }

    const tail = await this.getConsoleTextTail(buildUrl, maxChars);
    return { text: tail.text, truncated: tail.truncated };
  }

  async getConsoleTextTail(buildUrl: string, maxChars: number): Promise<JenkinsConsoleTextTail> {
    if (maxChars <= 0) {
      const url = buildActionUrl(buildUrl, "consoleText");
      const text = await this.context.requestText(url);
      return {
        text,
        truncated: false,
        nextStart: text.length,
        progressiveSupported: false
      };
    }

    const headUrl = this.buildProgressiveTextUrl(buildUrl, 0);
    try {
      const headers = await this.context.requestHeaders(headUrl);
      const textSize = this.parseTextSize(headers["x-text-size"]);
      if (Number.isFinite(textSize) && textSize >= 0) {
        const start = Math.max(0, textSize - maxChars);
        const tailUrl = this.buildProgressiveTextUrl(buildUrl, start);
        const response = await this.context.requestTextWithHeaders(tailUrl);
        const responseSize = this.parseTextSize(response.headers["x-text-size"]);
        const nextStart = Number.isFinite(responseSize)
          ? responseSize
          : start + response.text.length;
        return {
          text: response.text,
          truncated: textSize > maxChars,
          nextStart,
          progressiveSupported: true
        };
      }
    } catch {
      // Fall through to consoleText for Jenkins instances that do not support HEAD.
    }

    const url = buildActionUrl(buildUrl, "consoleText");
    const text = await this.context.requestText(url);
    if (text.length > maxChars) {
      return {
        text: text.slice(text.length - maxChars),
        truncated: true,
        nextStart: text.length,
        progressiveSupported: false
      };
    }
    return {
      text,
      truncated: false,
      nextStart: text.length,
      progressiveSupported: false
    };
  }

  async getConsoleTextProgressive(
    buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText> {
    const safeStart = Math.max(0, Math.floor(start));
    const url = this.buildProgressiveTextUrl(buildUrl, safeStart);
    const response = await this.context.requestTextWithHeaders(url);
    const textSize = this.parseTextSize(response.headers["x-text-size"]);
    const moreData = this.parseMoreData(response.headers["x-more-data"]);
    return {
      text: response.text,
      textSize: Number.isFinite(textSize) ? textSize : safeStart + response.text.length,
      moreData: typeof moreData === "boolean" ? moreData : response.text.length > 0
    };
  }

  async getConsoleHtmlProgressive(
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml> {
    const safeStart = Math.max(0, Math.floor(start));
    const url = this.buildProgressiveHtmlUrl(buildUrl, safeStart);
    const response = await this.context.requestTextWithHeaders(url, {
      headers: annotator ? { "X-ConsoleAnnotator": annotator } : undefined
    });
    const textSize = this.parseTextSize(response.headers["x-text-size"]);
    const moreData = this.parseMoreData(response.headers["x-more-data"]);
    const nextAnnotator = this.parseConsoleAnnotator(response.headers["x-console-annotator"]);
    const textSizeKnown = Number.isFinite(textSize);
    return {
      html: response.text,
      textSize: textSizeKnown ? textSize : safeStart,
      textSizeKnown,
      moreData: typeof moreData === "boolean" ? moreData : response.text.length > 0,
      annotator: nextAnnotator
    };
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
      const hasParams = options.params ? Array.from(options.params.keys()).length > 0 : false;
      const allowEmptyParams = options.allowEmptyParams === true;
      if (!hasParams && !allowEmptyParams) {
        const fallbackUrl = buildActionUrl(jobUrl, "build");
        const fallbackResponse = await this.context.requestPostWithCrumb(fallbackUrl);
        return { queueLocation: fallbackResponse.location };
      }
      const url = buildActionUrl(jobUrl, "buildWithParameters");
      const body = options.params ? options.params.toString() : undefined;
      try {
        const response = await this.context.requestPostWithCrumb(url, body);
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

  async replayBuild(buildUrl: string): Promise<void> {
    const url = buildActionUrl(buildUrl, "replay/rebuild");
    await this.context.requestVoidWithCrumb(url);
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
    const params = options?.params;
    const hasParams = params ? Array.from(params.keys()).length > 0 : false;
    if (hasParams && params) {
      const url = new URL(buildActionUrl(buildUrl, "wfapi/inputSubmit"));
      url.searchParams.set("inputId", inputId);
      const body = this.buildInputSubmitBody(inputId, params, options?.proceedText);
      await this.context.requestVoidWithCrumb(url.toString(), body);
      return;
    }
    const proceedUrl = this.resolveInputUrl(buildUrl, options?.proceedUrl, inputId, "proceedEmpty");
    try {
      await this.context.requestVoidWithCrumb(proceedUrl);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        const fallbackUrl = this.resolveInputUrl(buildUrl, options?.proceedUrl, inputId, "proceed");
        await this.context.requestVoidWithCrumb(fallbackUrl);
        return;
      }
      throw error;
    }
  }

  async abortInput(buildUrl: string, inputId: string, abortUrl?: string): Promise<void> {
    const resolvedUrl = this.resolveInputUrl(buildUrl, abortUrl, inputId, "abort");
    await this.context.requestVoidWithCrumb(resolvedUrl);
  }

  private resolveInputUrl(
    buildUrl: string,
    actionUrl: string | undefined,
    inputId: string,
    fallbackAction: "proceedEmpty" | "proceed" | "abort"
  ): string {
    if (actionUrl) {
      try {
        return new URL(actionUrl, buildUrl).toString();
      } catch {
        // Fall back to the well-known input action route.
      }
    }
    return buildActionUrl(buildUrl, `input/${encodeURIComponent(inputId)}/${fallbackAction}`);
  }

  private buildInputSubmitBody(
    inputId: string,
    params: URLSearchParams,
    proceedText?: string
  ): string {
    const entries = Array.from(params.entries());
    const payload = {
      parameter: entries.map(([name, value]) => ({ name, value }))
    };
    const body = new URLSearchParams();
    body.set("inputId", inputId);
    body.set("proceed", proceedText?.trim() || "Proceed");
    body.set("json", JSON.stringify(payload));
    for (const [name, value] of entries) {
      body.set(name, value);
    }
    return body.toString();
  }

  private buildProgressiveTextUrl(buildUrl: string, start: number): string {
    const url = new URL(buildActionUrl(buildUrl, "logText/progressiveText"));
    url.searchParams.set("start", Math.max(0, Math.floor(start)).toString());
    return url.toString();
  }

  private buildProgressiveHtmlUrl(buildUrl: string, start: number): string {
    const url = new URL(buildActionUrl(buildUrl, "logText/progressiveHtml"));
    url.searchParams.set("start", Math.max(0, Math.floor(start)).toString());
    return url.toString();
  }

  private parseTextSize(value: string | string[] | undefined): number {
    const text = Array.isArray(value) ? value[0] : value;
    const parsed = text ? Number.parseInt(text, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private parseMoreData(value: string | string[] | undefined): boolean | undefined {
    const text = Array.isArray(value) ? value[0] : value;
    if (!text) {
      return undefined;
    }
    return text.toLowerCase() === "true";
  }

  private parseConsoleAnnotator(value: string | string[] | undefined): string | undefined {
    const text = Array.isArray(value) ? value[0] : value;
    if (!text) {
      return undefined;
    }
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

}
