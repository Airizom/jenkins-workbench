import type { IncomingHttpHeaders } from "node:http";
import { buildAuthHeaders } from "../auth";
import { JenkinsCrumbService } from "../crumbs";
import { JenkinsRequestError } from "../errors";
import {
  type JenkinsBufferResponse,
  type JenkinsPostResponse,
  type JenkinsStreamResponse,
  requestBufferWithHeaders as requestBufferWithHeadersInternal,
  requestHeaders as requestHeadersInternal,
  requestJson as requestJsonInternal,
  requestStream as requestStreamInternal,
  requestText as requestTextInternal,
  requestTextWithHeaders as requestTextWithHeadersInternal,
  requestTextWithOptions as requestTextWithOptionsInternal,
  requestVoidWithLocation as requestVoidWithLocationInternal
} from "../request";
import type { JenkinsClientOptions } from "../types";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsHttpClient implements JenkinsClientContext {
  public readonly baseUrl: string;
  private readonly username?: string;
  private readonly token?: string;
  private readonly requestTimeoutMs?: number;
  private readonly authHeader?: string;
  private readonly baseHeaders?: Record<string, string>;
  private readonly crumbService: JenkinsCrumbService;

  constructor(options: JenkinsClientOptions) {
    this.baseUrl = options.baseUrl.trim();
    const username = options.username?.trim();
    const token = options.token?.trim();
    this.username = username && username.length > 0 ? username : undefined;
    this.token = token && token.length > 0 ? token : undefined;
    this.requestTimeoutMs = options.requestTimeoutMs;
    const authHeaders = buildAuthHeaders(options.authConfig, {
      username: this.username,
      token: this.token
    });
    this.authHeader = authHeaders.authHeader;
    this.baseHeaders = authHeaders.headers;
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
    url: string,
    options?: { headers?: Record<string, string> }
  ): Promise<{ text: string; headers: IncomingHttpHeaders }> {
    return requestTextWithHeadersInternal(url, {
      ...this.getRequestOptions(),
      headers: this.mergeHeaders(options?.headers)
    });
  }

  async requestBufferWithHeaders(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.requestWithCrumbRetry((crumbHeaders) =>
      requestBufferWithHeadersInternal(url, {
        ...this.getRequestOptions(),
        headers: this.mergeHeaders(crumbHeaders),
        maxBytes: options?.maxBytes
      })
    );
  }

  async requestStream(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.requestWithCrumbRetry((crumbHeaders) =>
      requestStreamInternal(url, {
        ...this.getRequestOptions(),
        headers: this.mergeHeaders(crumbHeaders),
        maxBytes: options?.maxBytes
      })
    );
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

    return this.requestPostWithCrumbInternal(url, body, contentHeaders);
  }

  async requestPostWithCrumbRaw(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<JenkinsPostResponse> {
    const contentHeaders: Record<string, string> = { ...(headers ?? {}) };
    if (!("Content-Length" in contentHeaders)) {
      contentHeaders["Content-Length"] = Buffer.byteLength(body).toString();
    }
    return this.requestPostWithCrumbInternal(url, body, contentHeaders);
  }

  async requestPostTextWithCrumbRaw(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<string> {
    const contentHeaders: Record<string, string> = { ...(headers ?? {}) };
    if (!("Content-Length" in contentHeaders)) {
      contentHeaders["Content-Length"] = Buffer.byteLength(body).toString();
    }
    return this.requestPostTextWithCrumbInternal(url, body, contentHeaders);
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
      headers: this.mergeHeaders(options.headers),
      authHeader: this.authHeader,
      timeoutMs: this.requestTimeoutMs
    });
  }

  private async requestTextWithOptions(
    url: string,
    options: {
      method: "POST" | "GET" | "HEAD";
      headers?: Record<string, string>;
      body?: string;
      redirectCount?: number;
    }
  ): Promise<string> {
    return requestTextWithOptionsInternal(url, {
      ...options,
      headers: this.mergeHeaders(options.headers),
      authHeader: this.authHeader,
      timeoutMs: this.requestTimeoutMs
    });
  }

  private async requestPostWithCrumbInternal(
    url: string,
    body: string | undefined,
    contentHeaders: Record<string, string>
  ): Promise<JenkinsPostResponse> {
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

  private async requestPostTextWithCrumbInternal(
    url: string,
    body: string,
    contentHeaders: Record<string, string>
  ): Promise<string> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = crumbHeader
      ? { ...contentHeaders, [crumbHeader.field]: crumbHeader.value }
      : contentHeaders;

    try {
      return await this.requestTextWithOptions(url, { method: "POST", headers, body });
    } catch (error) {
      if (error instanceof JenkinsRequestError) {
        const statusCode = error.statusCode;
        if (statusCode === 401 || statusCode === 403) {
          this.crumbService.invalidate();
        }
        if (statusCode === 403) {
          const refreshed = await this.crumbService.getCrumbHeader(true);
          if (refreshed) {
            const retryHeaders = {
              ...contentHeaders,
              [refreshed.field]: refreshed.value
            };
            return await this.requestTextWithOptions(url, {
              method: "POST",
              headers: retryHeaders,
              body
            });
          }
        }
        if (
          typeof error.responseText === "string" &&
          statusCode !== undefined &&
          statusCode >= 400 &&
          statusCode < 600 &&
          statusCode !== 401 &&
          statusCode !== 403
        ) {
          return error.responseText;
        }
      }
      throw error;
    }
  }

  private getRequestOptions(): {
    authHeader?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } {
    return {
      authHeader: this.authHeader,
      headers: this.baseHeaders,
      timeoutMs: this.requestTimeoutMs
    };
  }

  private mergeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    const baseHeaders = this.baseHeaders;
    if (!baseHeaders || Object.keys(baseHeaders).length === 0) {
      return headers;
    }
    if (!headers || Object.keys(headers).length === 0) {
      return { ...baseHeaders };
    }
    return {
      ...baseHeaders,
      ...headers
    };
  }

  private async requestWithCrumbRetry<T>(
    requestFn: (headers?: Record<string, string>) => Promise<T>
  ): Promise<T> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = crumbHeader
      ? {
          [crumbHeader.field]: crumbHeader.value
        }
      : undefined;

    try {
      return await requestFn(headers);
    } catch (error) {
      if (error instanceof JenkinsRequestError) {
        if (error.statusCode === 401 || error.statusCode === 403) {
          this.crumbService.invalidate();
        }
        if (error.statusCode === 403) {
          const refreshed = await this.crumbService.getCrumbHeader(true);
          if (refreshed) {
            const retryHeaders = {
              [refreshed.field]: refreshed.value
            };
            return await requestFn(retryHeaders);
          }
        }
      }
      throw error;
    }
  }
}
