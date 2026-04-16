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
import {
  buildActionUrl,
  buildApiUrlFromBase,
  buildApiUrlFromItem,
  buildArtifactDownloadUrl,
  canonicalizeBuildUrlForEnvironment,
  ensureTrailingSlash
} from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { parseReplayDefinitionPage } from "./ReplayPageParser";
import { RestartFromStageClient } from "./RestartFromStageClient";

export type JenkinsBuildTriggerMode = "build" | "buildWithParameters";

export type JenkinsBuildTriggerOptions =
  | { mode: "build" }
  | {
      mode: "buildWithParameters";
      prepared?: PreparedBuildParametersRequest;
      allowEmptyParams?: boolean;
    };

const REPLAY_QUEUE_DISCOVERY_POLL_INTERVAL_MS = 500;
const REPLAY_QUEUE_DISCOVERY_TIMEOUT_MS = 5000;
const REPLAY_QUEUE_DISCOVERY_SETTLE_MS = 1000;

interface JenkinsReplayQueueSnapshot {
  knownIds: Set<number>;
  jobUrl: string;
}

interface JenkinsQueueDiscoveryItem {
  id: number;
  taskUrl?: string;
}

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
      const actionParts = ["_class", "urlName"];
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
    const actionParts = ["_class", "urlName", "failCount", "skipCount", "totalCount"];
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
      return { text, truncated: false, bytesRead: Buffer.byteLength(text, "utf8") };
    }

    const tail = await this.getConsoleTextTail(buildUrl, maxChars);
    return {
      text: tail.text,
      truncated: tail.truncated,
      bytesRead: Buffer.byteLength(tail.text, "utf8")
    };
  }

  async getConsoleTextHead(buildUrl: string, maxBytes: number): Promise<JenkinsConsoleText> {
    if (maxBytes <= 0) {
      return { text: "", truncated: false, bytesRead: 0 };
    }

    const url = buildActionUrl(buildUrl, "consoleText");
    const response = await this.context.requestStream(url);
    const contentLength = parseHeaderNumber(response.headers["content-length"]);
    const prefix = await readTextPrefixFromStream(response, maxBytes);
    return {
      text: prefix.text,
      truncated: prefix.truncated || (contentLength !== undefined && contentLength > maxBytes),
      bytesRead: prefix.bytesRead
    };
  }

  async getConsoleTextTail(buildUrl: string, maxChars: number): Promise<JenkinsConsoleTextTail> {
    if (maxChars <= 0) {
      const url = buildActionUrl(buildUrl, "consoleText");
      const text = await this.context.requestText(url);
      return {
        text,
        truncated: false,
        nextStart: text.length,
        progressiveSupported: false,
        bytesRead: Buffer.byteLength(text, "utf8")
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
          progressiveSupported: true,
          bytesRead: Buffer.byteLength(response.text, "utf8")
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
        progressiveSupported: false,
        bytesRead: Buffer.byteLength(text.slice(text.length - maxChars), "utf8")
      };
    }
    return {
      text,
      truncated: false,
      nextStart: text.length,
      progressiveSupported: false,
      bytesRead: Buffer.byteLength(text, "utf8")
    };
  }

  async getConsoleTextProgressive(
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<JenkinsProgressiveConsoleText> {
    const safeStart = Math.max(0, Math.floor(start));
    const url = this.buildProgressiveTextUrl(buildUrl, safeStart);
    if (maxBytes !== undefined && maxBytes > 0) {
      const response = await this.context.requestStream(url);
      const prefix = await readTextPrefixFromStream(response, maxBytes);
      const textSize = this.parseTextSize(response.headers["x-text-size"]);
      const moreData = this.parseMoreData(response.headers["x-more-data"]);
      const inferredMoreData = Number.isFinite(textSize)
        ? textSize > safeStart + prefix.bytesRead
        : prefix.bytesRead > 0;
      return {
        text: prefix.text,
        textSize:
          prefix.truncated || !Number.isFinite(textSize)
            ? safeStart + prefix.resumeBytes
            : textSize,
        moreData: prefix.truncated || (typeof moreData === "boolean" ? moreData : inferredMoreData),
        bytesRead: prefix.bytesRead
      };
    }
    const response = await this.context.requestTextWithHeaders(url);
    const textSize = this.parseTextSize(response.headers["x-text-size"]);
    const moreData = this.parseMoreData(response.headers["x-more-data"]);
    return {
      text: response.text,
      textSize: Number.isFinite(textSize) ? textSize : safeStart + response.text.length,
      moreData: typeof moreData === "boolean" ? moreData : response.text.length > 0,
      bytesRead: Buffer.byteLength(response.text, "utf8")
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
    const url = buildActionUrl(buildUrl, "replay/");
    const html = await this.context.requestText(url);
    return parseReplayDefinitionPage(html);
  }

  async runReplay(
    buildUrl: string,
    payload: JenkinsReplaySubmissionPayload
  ): Promise<JenkinsReplayResult> {
    const url = buildActionUrl(buildUrl, "replay/run");
    const replayQueueSnapshot = await this.captureReplayQueueSnapshot(buildUrl);
    const response = await this.context.requestPostWithCrumb(url, this.buildReplayRunBody(payload));
    const resolvedLocation = resolveActionLocation(url, response.location);
    let queueLocation = isQueueLocation(resolvedLocation) ? resolvedLocation : undefined;
    const buildLocation = queueLocation
      ? undefined
      : classifyReplayBuildLocation(buildUrl, resolvedLocation);
    if (!queueLocation && !buildLocation && replayQueueSnapshot) {
      queueLocation = await this.findReplayQueueLocation(replayQueueSnapshot);
    }
    const location = queueLocation ?? buildLocation;
    return {
      location,
      queueLocation,
      buildLocation
    };
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

  private buildReplayRunBody(payload: JenkinsReplaySubmissionPayload): string {
    const formPayload: Record<string, string> = {
      mainScript: payload.mainScript
    };
    for (const entry of payload.loadedScripts) {
      formPayload[entry.postField] = entry.script;
    }

    const body = new URLSearchParams();
    body.set("json", JSON.stringify(formPayload));
    for (const [name, value] of Object.entries(formPayload)) {
      body.set(name, value);
    }
    return body.toString();
  }

  private async captureReplayQueueSnapshot(
    buildUrl: string
  ): Promise<JenkinsReplayQueueSnapshot | undefined> {
    const jobUrl = resolveReplayJobUrl(this.context.baseUrl, buildUrl);
    if (!jobUrl) {
      return undefined;
    }

    try {
      const items = await this.getQueueDiscoveryItems();
      return {
        jobUrl,
        knownIds: new Set(
          items.filter((item) => isSameQueueTask(item.taskUrl, jobUrl)).map((item) => item.id)
        )
      };
    } catch {
      return undefined;
    }
  }

  private async findReplayQueueLocation(
    snapshot: JenkinsReplayQueueSnapshot
  ): Promise<string | undefined> {
    const deadline = Date.now() + REPLAY_QUEUE_DISCOVERY_TIMEOUT_MS;
    let candidateId: number | undefined;
    let candidateObservedAt: number | undefined;

    while (Date.now() < deadline) {
      try {
        const items = await this.getQueueDiscoveryItems();
        const candidateIds = new Set(
          items
            .filter(
              (item) =>
                !snapshot.knownIds.has(item.id) && isSameQueueTask(item.taskUrl, snapshot.jobUrl)
            )
            .map((item) => item.id)
        );

        if (candidateId !== undefined && !candidateIds.has(candidateId)) {
          candidateId = undefined;
          candidateObservedAt = undefined;
        }

        if (candidateIds.size > 1) {
          return undefined;
        }

        const nextCandidateId = candidateIds.values().next().value;
        if (nextCandidateId === undefined) {
          await delay(REPLAY_QUEUE_DISCOVERY_POLL_INTERVAL_MS);
          continue;
        }

        if (candidateId !== nextCandidateId) {
          candidateId = nextCandidateId;
          candidateObservedAt = Date.now();
        }

        if (
          candidateId !== undefined &&
          candidateObservedAt !== undefined &&
          Date.now() - candidateObservedAt >= REPLAY_QUEUE_DISCOVERY_SETTLE_MS
        ) {
          return buildQueueItemLocation(this.context.baseUrl, candidateId);
        }
      } catch {
        return undefined;
      }
      await delay(REPLAY_QUEUE_DISCOVERY_POLL_INTERVAL_MS);
    }
    return undefined;
  }

  private async getQueueDiscoveryItems(): Promise<JenkinsQueueDiscoveryItem[]> {
    const tree = "items[id,task[url]]";
    const url = buildApiUrlFromBase(this.context.baseUrl, "queue/api/json", tree);
    const response = await this.context.requestJson<{
      items?: Array<{ id?: number; task?: { url?: string } }>;
    }>(url);
    if (!Array.isArray(response.items)) {
      return [];
    }
    return response.items.flatMap((item) => {
      const id = typeof item.id === "number" && Number.isFinite(item.id) ? item.id : undefined;
      if (id === undefined) {
        return [];
      }
      return [{ id, taskUrl: item.task?.url }];
    });
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

function parseHeaderNumber(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readTextPrefixFromStream(
  response: JenkinsStreamResponse,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; bytesRead: number; resumeBytes: number }> {
  const stream = response.stream as NodeJS.ReadableStream & {
    destroy(error?: Error): void;
  };
  const contentLength = parseHeaderNumber(response.headers["content-length"]);
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let truncated = false;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
      if (error) {
        reject(error);
        return;
      }
      const bytes = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, receivedBytes);
      const trailingIncompleteBytes = getTrailingIncompleteUtf8ByteCount(bytes);
      const resumeBytes = Math.max(0, receivedBytes - trailingIncompleteBytes);
      resolve({
        text: (truncated ? bytes.subarray(0, resumeBytes) : bytes).toString("utf8"),
        truncated: truncated || (contentLength !== undefined && contentLength > maxBytes),
        bytesRead: receivedBytes,
        resumeBytes
      });
    };

    const onError = (error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    };

    const onEnd = () => finish();

    const onClose = () => finish();

    const onData = (chunk: unknown) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const remaining = maxBytes - receivedBytes;
      if (remaining <= 0) {
        truncated = true;
        abortStreamResponse(response);
        return;
      }
      const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      receivedBytes += slice.length;
      chunks.push(slice);
      const definitelyMoreData =
        slice.length < buffer.length ||
        (contentLength !== undefined && contentLength > receivedBytes);
      if (receivedBytes >= maxBytes && definitelyMoreData) {
        truncated = true;
        abortStreamResponse(response);
      }
    };

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

function abortStreamResponse(response: JenkinsStreamResponse): void {
  response.abort();
}

// Progressive console resume offsets are byte-based, so drop any partial UTF-8
// sequence at the end of the buffered prefix before advancing the start offset.
function getTrailingIncompleteUtf8ByteCount(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let continuationBytes = 0;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const byte = buffer[index];
    if ((byte & 0b1100_0000) !== 0b1000_0000) {
      const expectedLength = getUtf8SequenceLength(byte);
      if (expectedLength === 0) {
        return 0;
      }
      const actualLength = continuationBytes + 1;
      return actualLength < expectedLength ? actualLength : 0;
    }
    continuationBytes += 1;
  }

  return continuationBytes;
}

function getUtf8SequenceLength(byte: number): number {
  if ((byte & 0b1000_0000) === 0) {
    return 1;
  }
  if ((byte & 0b1110_0000) === 0b1100_0000) {
    return 2;
  }
  if ((byte & 0b1111_0000) === 0b1110_0000) {
    return 3;
  }
  if ((byte & 0b1111_1000) === 0b1111_0000) {
    return 4;
  }
  return 0;
}

function resolveActionLocation(
  requestUrl: string,
  location: string | undefined
): string | undefined {
  if (!location) {
    return undefined;
  }
  try {
    return new URL(location, requestUrl).toString();
  } catch {
    return location;
  }
}

function isQueueLocation(location: string | undefined): boolean {
  return Boolean(location && /\/queue\/item\/\d+/.test(location));
}

function resolveReplayJobUrl(environmentUrl: string, buildUrl: string): string | undefined {
  try {
    const canonicalBuildUrl =
      canonicalizeBuildUrlForEnvironment(environmentUrl, buildUrl) ?? ensureTrailingSlash(buildUrl);
    return new URL("../", canonicalBuildUrl).toString();
  } catch {
    return undefined;
  }
}

function isSameQueueTask(taskUrl: string | undefined, jobUrl: string): boolean {
  return Boolean(taskUrl && areEquivalentLocations(taskUrl, jobUrl));
}

function classifyReplayBuildLocation(
  buildUrl: string,
  location: string | undefined
): string | undefined {
  if (!location || !isBuildLocation(location)) {
    return undefined;
  }
  return areEquivalentLocations(buildUrl, location) ? undefined : location;
}

function isBuildLocation(location: string): boolean {
  return /\/job\/.+\/\d+\/?$/.test(location);
}

function areEquivalentLocations(left: string, right: string): boolean {
  return normalizeLocationForComparison(left) === normalizeLocationForComparison(right);
}

function normalizeLocationForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = ensureTrailingSlash(url.pathname);
    return url.toString();
  } catch {
    return ensureTrailingSlash(value.split(/[?#]/, 1)[0] ?? value);
  }
}

function buildQueueItemLocation(baseUrl: string, queueId: number): string {
  return new URL(`queue/item/${Math.floor(queueId)}/`, ensureTrailingSlash(baseUrl)).toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
