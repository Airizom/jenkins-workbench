import type {
  JenkinsBuild,
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText,
  JenkinsArtifact,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../types";
import { buildActionUrl, buildApiUrlFromItem, buildArtifactDownloadUrl } from "../urls";
import type { JenkinsBufferResponse, JenkinsStreamResponse } from "../request";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsBuildsApi {
  constructor(private readonly context: JenkinsClientContext) {}

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

  async getTestReport(buildUrl: string): Promise<JenkinsTestReport> {
    const url = new URL(buildActionUrl(buildUrl, "testReport/api/json"));
    url.searchParams.set(
      "tree",
      "failCount,skipCount,totalCount,suites[cases[name,className,status]]"
    );
    return this.context.requestJson<JenkinsTestReport>(url.toString());
  }

  async getWorkflowRun(buildUrl: string): Promise<JenkinsWorkflowRun> {
    const url = buildActionUrl(buildUrl, "wfapi/describe");
    return this.context.requestJson<JenkinsWorkflowRun>(url);
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
    params?: URLSearchParams
  ): Promise<{ queueLocation?: string }> {
    if (params && Array.from(params.keys()).length > 0) {
      const url = buildActionUrl(jobUrl, "buildWithParameters");
      const response = await this.context.requestPostWithCrumb(url, params.toString());
      return { queueLocation: response.location };
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
    const url = buildActionUrl(buildUrl, "replay");
    await this.context.requestVoidWithCrumb(url);
  }

  async rebuildBuild(buildUrl: string): Promise<void> {
    const url = buildActionUrl(buildUrl, "rebuild");
    await this.context.requestVoidWithCrumb(url);
  }

  private buildProgressiveTextUrl(buildUrl: string, start: number): string {
    const url = new URL(buildActionUrl(buildUrl, "logText/progressiveText"));
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
}
