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
import type { JenkinsAuthConfig, JenkinsAuthConfigRefresh, JenkinsClientOptions } from "../types";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsHttpClient implements JenkinsClientContext {
  public readonly baseUrl: string;
  private readonly username?: string;
  private readonly token?: string;
  private readonly requestTimeoutMs?: number;
  private readonly refreshAuthConfig?: JenkinsAuthConfigRefresh;
  private currentAuthConfig?: JenkinsAuthConfig;
  private authHeader?: string;
  private baseHeaders?: Record<string, string>;
  private readonly crumbService: JenkinsCrumbService;

  constructor(options: JenkinsClientOptions) {
    this.baseUrl = options.baseUrl.trim();
    const username = options.username?.trim();
    const token = options.token?.trim();
    this.username = username && username.length > 0 ? username : undefined;
    this.token = token && token.length > 0 ? token : undefined;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.refreshAuthConfig = options.refreshAuthConfig;
    this.currentAuthConfig = options.authConfig;
    this.updateAuthHeaders();
    this.crumbService = new JenkinsCrumbService(this.baseUrl, async (url) => {
      const { text, headers } = await this.requestTextWithHeaders(url);
      return {
        body: JSON.parse(text) as { crumbRequestField?: string; crumb?: string },
        headers
      };
    });
  }

  async requestJson<T>(url: string): Promise<T> {
    return this.requestWithSsoRetry(() => requestJsonInternal<T>(url, this.getRequestOptions()));
  }

  async requestHeaders(url: string): Promise<IncomingHttpHeaders> {
    return this.requestWithSsoRetry(() => requestHeadersInternal(url, this.getRequestOptions()));
  }

  async requestText(url: string): Promise<string> {
    return this.requestWithSsoRetry(() => requestTextInternal(url, this.getRequestOptions()));
  }

  async requestTextWithHeaders(
    url: string,
    options?: { headers?: Record<string, string> }
  ): Promise<{ text: string; headers: IncomingHttpHeaders }> {
    return this.requestWithSsoRetry(() =>
      requestTextWithHeadersInternal(url, {
        ...this.getRequestOptions(),
        headers: this.mergeHeaders(options?.headers)
      })
    );
  }

  async requestBufferWithHeaders(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.requestWithSsoRetry(() =>
      this.requestWithCrumbRetry((crumbHeaders) =>
        requestBufferWithHeadersInternal(url, {
          ...this.getRequestOptions(),
          headers: this.mergeHeaders(crumbHeaders),
          maxBytes: options?.maxBytes
        })
      )
    );
  }

  async requestStream(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.requestWithSsoRetry(() =>
      this.requestWithCrumbRetry((crumbHeaders) =>
        requestStreamInternal(url, {
          ...this.getRequestOptions(),
          headers: this.mergeHeaders(crumbHeaders),
          maxBytes: options?.maxBytes
        })
      )
    );
  }

  async requestVoidWithCrumb(url: string, body?: string | Uint8Array): Promise<void> {
    await this.requestWithSsoRetry(async () => {
      await this.requestPostWithCrumbInternal(url, body, this.buildContentHeaders(body));
    });
  }

  async requestPostWithCrumb(
    url: string,
    body?: string | Uint8Array
  ): Promise<JenkinsPostResponse> {
    return this.requestWithSsoRetry(() =>
      this.requestPostWithCrumbInternal(url, body, this.buildContentHeaders(body))
    );
  }

  async requestPostWithCrumbRaw(
    url: string,
    body: string | Uint8Array,
    headers?: Record<string, string>
  ): Promise<JenkinsPostResponse> {
    return this.requestWithSsoRetry(() => {
      const contentHeaders = this.buildRawContentHeaders(body, headers);
      return this.requestPostWithCrumbInternal(url, body, contentHeaders);
    });
  }

  async requestPostTextWithCrumbRaw(
    url: string,
    body: string | Uint8Array,
    headers?: Record<string, string>
  ): Promise<string> {
    return this.requestWithSsoRetry(() => {
      const contentHeaders = this.buildRawContentHeaders(body, headers);
      return this.requestPostTextWithCrumbInternal(url, body, contentHeaders);
    });
  }

  private buildContentHeaders(body: string | Uint8Array | undefined): Record<string, string> {
    const contentHeaders: Record<string, string> = {};
    if (body !== undefined) {
      if (typeof body === "string") {
        contentHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
      contentHeaders["Content-Length"] = this.getBodyLength(body).toString();
    }
    return contentHeaders;
  }

  private buildRawContentHeaders(
    body: string | Uint8Array,
    headers?: Record<string, string>
  ): Record<string, string> {
    const contentHeaders: Record<string, string> = { ...(headers ?? {}) };
    if (!("Content-Length" in contentHeaders)) {
      contentHeaders["Content-Length"] = this.getBodyLength(body).toString();
    }
    return contentHeaders;
  }

  private updateAuthHeaders(): void {
    const authHeaders = buildAuthHeaders(this.currentAuthConfig, {
      username: this.username,
      token: this.token
    });
    this.authHeader = authHeaders.authHeader;
    this.baseHeaders = authHeaders.headers;
  }

  private async requestVoidWithLocation(
    url: string,
    options: {
      method: "POST" | "GET";
      headers?: Record<string, string>;
      body?: string | Uint8Array;
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
      body?: string | Uint8Array;
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
    body: string | Uint8Array | undefined,
    contentHeaders: Record<string, string>
  ): Promise<JenkinsPostResponse> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = this.buildHeadersWithCrumb(contentHeaders, crumbHeader);

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
            const retryHeaders = this.buildHeadersWithCrumb(contentHeaders, refreshed);
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
    body: string | Uint8Array,
    contentHeaders: Record<string, string>
  ): Promise<string> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = this.buildHeadersWithCrumb(contentHeaders, crumbHeader);

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
            const retryHeaders = this.buildHeadersWithCrumb(contentHeaders, refreshed);
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

  private buildHeadersWithCrumb(
    contentHeaders: Record<string, string>,
    crumbHeader?: { field: string; value: string; cookie?: string }
  ): Record<string, string> {
    if (!crumbHeader) {
      return contentHeaders;
    }

    const headers = {
      ...contentHeaders,
      [crumbHeader.field]: crumbHeader.value
    };

    if (
      crumbHeader.cookie &&
      !this.hasHeader(this.baseHeaders, "Cookie") &&
      !this.hasHeader(contentHeaders, "Cookie")
    ) {
      headers.Cookie = crumbHeader.cookie;
    }

    return headers;
  }

  private hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
    if (!headers) {
      return false;
    }
    const normalizedName = name.toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
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

  private async requestWithSsoRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (!(await this.refreshSsoAuthConfig(error))) {
        throw error;
      }
      return await requestFn();
    }
  }

  private async refreshSsoAuthConfig(error: unknown): Promise<boolean> {
    if (!this.shouldRefreshSsoAuth(error) || !this.currentAuthConfig || !this.refreshAuthConfig) {
      return false;
    }

    const refreshed = await this.refreshAuthConfig(this.currentAuthConfig);
    if (!refreshed || refreshed.type !== "sso") {
      return false;
    }

    this.currentAuthConfig = refreshed;
    this.updateAuthHeaders();
    this.crumbService.invalidate();
    return true;
  }

  private shouldRefreshSsoAuth(error: unknown): boolean {
    if (this.currentAuthConfig?.type !== "sso") {
      return false;
    }
    if (!(error instanceof JenkinsRequestError)) {
      return false;
    }
    return (
      error.message.toLowerCase().includes("redirected to login") ||
      this.hasSsoUnauthenticatedSignal(error)
    );
  }

  private hasSsoUnauthenticatedSignal(error: JenkinsRequestError): boolean {
    if (error.statusCode !== 401 && error.statusCode !== 403) {
      return false;
    }

    const responseText = error.responseText?.toLowerCase() ?? "";
    if (
      responseText.includes("local sso session required") ||
      responseText.includes("/__sso/login") ||
      this.responseTextIncludesSsoLoginUrl(responseText)
    ) {
      return true;
    }

    const authenticateHeader = error.responseHeaders?.["www-authenticate"];
    const authenticateValues = Array.isArray(authenticateHeader)
      ? authenticateHeader
      : [authenticateHeader ?? ""];
    return authenticateValues.some((value) => {
      const normalized = value.toLowerCase();
      return (
        normalized.includes("localsso") ||
        normalized.includes("sso") ||
        normalized.includes("saml") ||
        normalized.includes("oidc") ||
        normalized.includes("oauth")
      );
    });
  }

  private responseTextIncludesSsoLoginUrl(responseText: string): boolean {
    if (this.currentAuthConfig?.type !== "sso" || responseText.length === 0) {
      return false;
    }

    try {
      const loginUrl = new URL(this.currentAuthConfig.loginUrl);
      const loginPath = `${loginUrl.pathname}${loginUrl.search}`.toLowerCase();
      return (
        responseText.includes(loginUrl.toString().toLowerCase()) ||
        (loginPath.length > 1 && responseText.includes(loginPath))
      );
    } catch {
      return false;
    }
  }

  private getBodyLength(body: string | Uint8Array): number {
    return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  }
}
