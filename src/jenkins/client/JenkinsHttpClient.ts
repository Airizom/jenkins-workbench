import type { IncomingHttpHeaders } from "node:http";
import { getAuthorizationHeader } from "../auth";
import { JenkinsCrumbService } from "../crumbs";
import { JenkinsRequestError } from "../errors";
import {
  type JenkinsPostResponse,
  requestHeaders as requestHeadersInternal,
  requestJson as requestJsonInternal,
  requestText as requestTextInternal,
  requestTextWithHeaders as requestTextWithHeadersInternal,
  requestVoidWithLocation as requestVoidWithLocationInternal
} from "../request";
import type { JenkinsClientOptions } from "../types";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsHttpClient implements JenkinsClientContext {
  public readonly baseUrl: string;
  private readonly username?: string;
  private readonly token?: string;
  private readonly requestTimeoutMs?: number;
  private readonly crumbService: JenkinsCrumbService;

  constructor(options: JenkinsClientOptions) {
    this.baseUrl = options.baseUrl.trim();
    const username = options.username?.trim();
    const token = options.token?.trim();
    this.username = username && username.length > 0 ? username : undefined;
    this.token = token && token.length > 0 ? token : undefined;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.crumbService = new JenkinsCrumbService(this.baseUrl, (url) => this.requestJson(url));
  }

  async requestJson<T>(url: string): Promise<T> {
    return requestJsonInternal<T>(url, this.getRequestOptions());
  }

  async requestHeaders(url: string): Promise<IncomingHttpHeaders> {
    return requestHeadersInternal(url, this.getRequestOptions());
  }

  async requestText(url: string): Promise<string> {
    return requestTextInternal(url, this.getRequestOptions());
  }

  async requestTextWithHeaders(
    url: string
  ): Promise<{ text: string; headers: IncomingHttpHeaders }> {
    return requestTextWithHeadersInternal(url, this.getRequestOptions());
  }

  async requestVoidWithCrumb(url: string, body?: string): Promise<void> {
    await this.requestPostWithCrumb(url, body);
  }

  async requestPostWithCrumb(url: string, body?: string): Promise<JenkinsPostResponse> {
    const contentHeaders: Record<string, string> = {};
    if (body !== undefined) {
      contentHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      contentHeaders["Content-Length"] = Buffer.byteLength(body).toString();
    }

    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = crumbHeader
      ? { ...contentHeaders, [crumbHeader.field]: crumbHeader.value }
      : contentHeaders;

    try {
      return await this.requestVoidWithLocation(url, { method: "POST", headers, body });
    } catch (error) {
      if (error instanceof JenkinsRequestError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          this.crumbService.invalidate();
        }
        if (error.statusCode === 403) {
          const refreshed = await this.crumbService.getCrumbHeader(true);
          if (refreshed) {
            const retryHeaders = {
              ...contentHeaders,
              [refreshed.field]: refreshed.value
            };
            return await this.requestVoidWithLocation(url, {
              method: "POST",
              headers: retryHeaders,
              body
            });
          }
        }
      }
      throw error;
    }
  }

  private async requestVoidWithLocation(
    url: string,
    options: {
      method: "POST" | "GET";
      headers?: Record<string, string>;
      body?: string;
      redirectCount?: number;
    }
  ): Promise<JenkinsPostResponse> {
    return requestVoidWithLocationInternal(url, {
      ...options,
      authHeader: this.getAuthorizationHeader(),
      timeoutMs: this.requestTimeoutMs
    });
  }

  private getRequestOptions(): { authHeader?: string; timeoutMs?: number } {
    return {
      authHeader: getAuthorizationHeader(this.username, this.token),
      timeoutMs: this.requestTimeoutMs
    };
  }

  private getAuthorizationHeader(): string | undefined {
    return getAuthorizationHeader(this.username, this.token);
  }
}
