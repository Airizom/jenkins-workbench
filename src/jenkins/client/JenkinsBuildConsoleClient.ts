import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText
} from "../types";
import { buildActionUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import { parseHeaderNumber, readTextPrefixFromStream } from "./JenkinsConsoleStream";

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
