import { JenkinsRequestError } from "../errors";
import { parseContentLength } from "../request/responses";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText
} from "../types";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  buildProgressiveConsoleHtmlResult,
  parseHeaderBoolean,
  parseHeaderInteger,
  readTextPrefixFromStream
} from "./JenkinsConsoleStream";

const UTF8_BOUNDARY_SLACK_BYTES = 3;
const MAX_UTF8_BYTES_PER_CHARACTER = 4;

export class JenkinsBuildConsoleClient {
  constructor(private readonly context: JenkinsClientContext) {}

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
    const contentLength = parseContentLength(response.headers["content-length"]);
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
        nextStart: Buffer.byteLength(text, "utf8"),
        progressiveSupported: false,
        bytesRead: Buffer.byteLength(text, "utf8")
      };
    }

    const headUrl = this.buildProgressiveTextUrl(buildUrl, 0);
    try {
      const headers = await this.context.requestHeaders(headUrl);
      const textSize = parseHeaderInteger(headers["x-text-size"]);
      if (Number.isFinite(textSize) && textSize >= 0) {
        const start = Math.max(0, textSize - this.getTailFetchBytes(maxChars));
        const tailUrl = this.buildProgressiveTextUrl(buildUrl, start);
        const response = await this.context.requestTextWithHeaders(tailUrl);
        const responseSize = parseHeaderInteger(response.headers["x-text-size"]);
        const nextStart = Number.isFinite(responseSize)
          ? responseSize
          : start + Buffer.byteLength(response.text, "utf8");
        const tailText = this.trimTailText(response.text, maxChars);
        return {
          text: tailText,
          truncated: start > 0 || response.text !== tailText,
          nextStart,
          progressiveSupported: true,
          bytesRead: Buffer.byteLength(tailText, "utf8")
        };
      }
    } catch (error) {
      if (!this.isUnsupportedProgressiveHeadError(error)) {
        throw error;
      }
      // Fall through to consoleText for Jenkins instances that do not support HEAD.
    }

    const url = buildActionUrl(buildUrl, "consoleText");
    const text = await this.context.requestText(url);
    const tailText = this.trimTailText(text, maxChars);
    return {
      text: tailText,
      truncated: text !== tailText,
      nextStart: Buffer.byteLength(text, "utf8"),
      progressiveSupported: false,
      bytesRead: Buffer.byteLength(tailText, "utf8")
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
      const textSize = parseHeaderInteger(response.headers["x-text-size"]);
      const moreData = parseHeaderBoolean(response.headers["x-more-data"]);
      const inferredMoreData = Number.isFinite(textSize)
        ? textSize > safeStart + prefix.bytesRead
        : prefix.bytesRead > 0;
      let nextTextSize = safeStart + prefix.resumeBytes;
      if (!prefix.truncated && Number.isFinite(textSize)) {
        nextTextSize = textSize;
      }
      return {
        text: prefix.text,
        textSize: nextTextSize,
        moreData: prefix.truncated || (moreData ?? inferredMoreData),
        bytesRead: prefix.bytesRead
      };
    }
    const response = await this.context.requestTextWithHeaders(url);
    const textSize = parseHeaderInteger(response.headers["x-text-size"]);
    const moreData = parseHeaderBoolean(response.headers["x-more-data"]);
    return {
      text: response.text,
      textSize: Number.isFinite(textSize)
        ? textSize
        : safeStart + Buffer.byteLength(response.text, "utf8"),
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
    return buildProgressiveConsoleHtmlResult(response, safeStart);
  }

  private buildProgressiveTextUrl(buildUrl: string, start: number): string {
    return this.buildProgressiveConsoleUrl(buildUrl, "logText/progressiveText", start);
  }

  private buildProgressiveHtmlUrl(buildUrl: string, start: number): string {
    return this.buildProgressiveConsoleUrl(buildUrl, "logText/progressiveHtml", start);
  }

  private buildProgressiveConsoleUrl(buildUrl: string, action: string, start: number): string {
    const url = new URL(buildActionUrl(buildUrl, action));
    url.searchParams.set("start", Math.max(0, Math.floor(start)).toString());
    return url.toString();
  }

  private getTailFetchBytes(maxChars: number): number {
    return maxChars * MAX_UTF8_BYTES_PER_CHARACTER + UTF8_BOUNDARY_SLACK_BYTES;
  }

  private trimTailText(text: string, maxChars: number): string {
    const characters = Array.from(text);
    return characters.length > maxChars
      ? characters.slice(characters.length - maxChars).join("")
      : text;
  }

  private isUnsupportedProgressiveHeadError(error: unknown): boolean {
    return (
      error instanceof JenkinsRequestError && (error.statusCode === 404 || error.statusCode === 405)
    );
  }
}
