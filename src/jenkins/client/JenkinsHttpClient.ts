import type { IncomingHttpHeaders } from "node:http";
import { buildAuthHeaders } from "../auth";
import { type JenkinsCrumbHeader, JenkinsCrumbService } from "../crumbs";
import { JenkinsRequestError } from "../errors";
import {
  type JenkinsBufferResponse,
  type JenkinsPostResponse,
  type JenkinsSimpleRequestOptions,
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

const EMPTY_HEADERS: Record<string, string> = {};

export class JenkinsHttpClient implements JenkinsClientContext {
  public readonly baseUrl: string;
  private readonly username?: string;
  private readonly token?: string;
  private readonly requestTimeoutMs?: number;
  private readonly refreshAuthConfig?: JenkinsAuthConfigRefresh;
  private currentAuthConfig?: JenkinsAuthConfig;
  private authHeader?: string;
  private baseHeaders?: Record<string, string>;
  private hasBaseHeaders = false;
  private baseHeadersHaveCookie = false;
  private requestOptions!: JenkinsSimpleRequestOptions;
  private cachedCrumbHeader?: JenkinsCrumbHeader;
  private cachedCrumbRequestHeaders?: Record<string, string>;
  private ssoLoginUrlText?: string;
  private ssoLoginPath?: string;
  private ssoLoginMatchersCached = false;
  private ssoAuthRefresh?: Promise<boolean>;
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
      requestTextWithHeadersInternal(url, this.getRequestOptions(options?.headers))
    );
  }

  async requestBufferWithHeaders(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.requestWithSsoRetry(() =>
      this.requestWithCrumbRetry((crumbHeaders) =>
        requestBufferWithHeadersInternal(
          url,
          this.getRequestOptions(crumbHeaders, options?.maxBytes)
        )
      )
    );
  }

  async requestStream(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsStreamResponse> {
    return this.requestWithSsoRetry(() =>
      this.requestWithCrumbRetry((crumbHeaders) =>
        requestStreamInternal(url, this.getRequestOptions(crumbHeaders, options?.maxBytes))
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
    headers?: Record<string, string>,
    options?: { acceptErrorStatuses?: number[] }
  ): Promise<string> {
    return this.requestWithSsoRetry(() => {
      const contentHeaders = this.buildRawContentHeaders(body, headers);
      return this.requestPostTextWithCrumbInternal(url, body, contentHeaders, options);
    });
  }

  private buildContentHeaders(body: string | Uint8Array | undefined): Record<string, string> {
    if (body === undefined) {
      return EMPTY_HEADERS;
    }

    const contentLength = this.getBodyLength(body).toString();
    return typeof body === "string"
      ? {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": contentLength
        }
      : { "Content-Length": contentLength };
  }

  private buildRawContentHeaders(
    body: string | Uint8Array,
    headers?: Record<string, string>
  ): Record<string, string> {
    if (!headers) {
      return { "Content-Length": this.getBodyLength(body).toString() };
    }

    const contentHeaders: Record<string, string> = { ...headers };
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
    this.updateBaseHeaderFlags(authHeaders.headers);
    this.baseHeaders = this.hasBaseHeaders ? authHeaders.headers : undefined;
    this.requestOptions = {
      authHeader: this.authHeader,
      headers: this.baseHeaders,
      timeoutMs: this.requestTimeoutMs
    };
    this.clearSsoLoginMatchers();
  }

  private clearSsoLoginMatchers(): void {
    this.ssoLoginUrlText = undefined;
    this.ssoLoginPath = undefined;
    this.ssoLoginMatchersCached = false;
  }

  private ensureSsoLoginMatchers(): void {
    if (this.ssoLoginMatchersCached) {
      return;
    }

    this.ssoLoginMatchersCached = true;
    if (this.currentAuthConfig?.type !== "sso") {
      return;
    }

    try {
      const loginUrl = new URL(this.currentAuthConfig.loginUrl);
      const loginPath = `${loginUrl.pathname}${loginUrl.search}`.toLowerCase();
      this.ssoLoginUrlText = loginUrl.toString().toLowerCase();
      this.ssoLoginPath = loginPath.length > 1 ? loginPath : undefined;
    } catch {
      // Invalid SSO URLs are ignored here just as they were during per-error matching.
    }
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
      method: options.method,
      headers: this.mergeHeaders(options.headers),
      body: options.body,
      redirectCount: options.redirectCount,
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
      method: options.method,
      headers: this.mergeHeaders(options.headers),
      body: options.body,
      redirectCount: options.redirectCount,
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
    return this.requestPostWithCrumbRetry(contentHeaders, headers, (requestHeaders) =>
      this.requestVoidWithLocation(url, { method: "POST", headers: requestHeaders, body })
    );
  }

  private async requestPostTextWithCrumbInternal(
    url: string,
    body: string | Uint8Array,
    contentHeaders: Record<string, string>,
    options?: { acceptErrorStatuses?: number[] }
  ): Promise<string> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = this.buildHeadersWithCrumb(contentHeaders, crumbHeader);
    try {
      return await this.requestPostWithCrumbRetry(contentHeaders, headers, (requestHeaders) =>
        this.requestTextWithOptions(url, { method: "POST", headers: requestHeaders, body })
      );
    } catch (error) {
      // Callers that sniff endpoint availability (e.g. 404 HTML pages) opt in
      // to receiving specific error bodies as text; everything else throws.
      if (
        error instanceof JenkinsRequestError &&
        typeof error.responseText === "string" &&
        error.statusCode !== undefined &&
        options?.acceptErrorStatuses?.includes(error.statusCode)
      ) {
        return error.responseText;
      }
      throw error;
    }
  }

  private async requestPostWithCrumbRetry<T>(
    contentHeaders: Record<string, string>,
    headers: Record<string, string>,
    request: (headers: Record<string, string>) => Promise<T>
  ): Promise<T> {
    try {
      return await request(headers);
    } catch (error) {
      return this.retryAfterCrumbError(error, (refreshed) =>
        request(this.buildHeadersWithCrumb(contentHeaders, refreshed))
      );
    }
  }

  private getRequestOptions(
    headers?: Record<string, string>,
    maxBytes?: number
  ): JenkinsSimpleRequestOptions {
    if (!headers && maxBytes === undefined) {
      return this.requestOptions;
    }

    const requestOptions: JenkinsSimpleRequestOptions = {
      authHeader: this.authHeader,
      headers: this.mergeHeaders(headers),
      timeoutMs: this.requestTimeoutMs
    };
    if (maxBytes !== undefined) {
      requestOptions.maxBytes = maxBytes;
    }
    return requestOptions;
  }

  private mergeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    if (!this.hasBaseHeaders) {
      return headers;
    }
    const baseHeaders = this.baseHeaders;
    if (!headers || !this.hasAnyHeader(headers)) {
      return baseHeaders;
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
      !this.baseHeadersHaveCookie &&
      !this.hasCookieHeader(contentHeaders)
    ) {
      headers.Cookie = crumbHeader.cookie;
    }

    return headers;
  }

  private updateBaseHeaderFlags(headers: Record<string, string> | undefined): void {
    this.hasBaseHeaders = false;
    this.baseHeadersHaveCookie = false;
    if (!headers) {
      return;
    }

    for (const key in headers) {
      if (Object.hasOwn(headers, key)) {
        this.hasBaseHeaders = true;
        if (key.toLowerCase() === "cookie") {
          this.baseHeadersHaveCookie = true;
          return;
        }
      }
    }
  }

  private hasAnyHeader(headers: Record<string, string> | undefined): boolean {
    if (!headers) {
      return false;
    }
    for (const key in headers) {
      if (Object.hasOwn(headers, key)) {
        return true;
      }
    }
    return false;
  }

  private hasCookieHeader(headers: Record<string, string> | undefined): boolean {
    if (!headers) {
      return false;
    }
    for (const key in headers) {
      if (Object.hasOwn(headers, key) && key.toLowerCase() === "cookie") {
        return true;
      }
    }
    return false;
  }

  private getCrumbRequestHeaders(crumbHeader: JenkinsCrumbHeader): Record<string, string> {
    if (this.cachedCrumbHeader === crumbHeader && this.cachedCrumbRequestHeaders) {
      return this.cachedCrumbRequestHeaders;
    }

    const headers = {
      [crumbHeader.field]: crumbHeader.value
    };
    this.cachedCrumbHeader = crumbHeader;
    this.cachedCrumbRequestHeaders = headers;
    return headers;
  }

  private clearCachedCrumbRequestHeaders(): void {
    this.cachedCrumbHeader = undefined;
    this.cachedCrumbRequestHeaders = undefined;
  }

  private async requestWithCrumbRetry<T>(
    requestFn: (headers?: Record<string, string>) => Promise<T>
  ): Promise<T> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = crumbHeader ? this.getCrumbRequestHeaders(crumbHeader) : undefined;

    try {
      return await requestFn(headers);
    } catch (error) {
      return this.retryAfterCrumbError(error, async (refreshed) =>
        requestFn(this.getCrumbRequestHeaders(refreshed))
      );
    }
  }

  private async retryAfterCrumbError<T>(
    error: unknown,
    retry: (refreshed: JenkinsCrumbHeader) => Promise<T>
  ): Promise<T> {
    if (error instanceof JenkinsRequestError) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        this.crumbService.invalidate();
        this.clearCachedCrumbRequestHeaders();
      }
      if (error.statusCode === 403) {
        const refreshed = await this.crumbService.getCrumbHeader(true);
        if (refreshed) {
          return retry(refreshed);
        }
      }
    }
    throw error;
  }

  private async requestWithSsoRetry<T>(requestFn: () => Promise<T>): Promise<T> {
    const authConfig = this.currentAuthConfig;
    try {
      return await requestFn();
    } catch (error) {
      if (!(await this.refreshSsoAuthConfig(error, authConfig))) {
        throw error;
      }
      return requestFn();
    }
  }

  private async refreshSsoAuthConfig(
    error: unknown,
    authConfig: JenkinsAuthConfig | undefined
  ): Promise<boolean> {
    if (!this.shouldRefreshSsoAuth(error) || !authConfig || !this.refreshAuthConfig) {
      return false;
    }

    if (this.currentAuthConfig !== authConfig) {
      return true;
    }

    if (this.ssoAuthRefresh) {
      return this.ssoAuthRefresh;
    }

    const refresh = this.performSsoAuthRefresh(authConfig);
    this.ssoAuthRefresh = refresh;
    try {
      return await refresh;
    } finally {
      if (this.ssoAuthRefresh === refresh) {
        this.ssoAuthRefresh = undefined;
      }
    }
  }

  private async performSsoAuthRefresh(authConfig: JenkinsAuthConfig): Promise<boolean> {
    const refreshed = await this.refreshAuthConfig?.(authConfig);
    if (!refreshed || refreshed.type !== "sso") {
      return false;
    }

    if (this.currentAuthConfig !== authConfig) {
      return true;
    }

    this.currentAuthConfig = refreshed;
    this.updateAuthHeaders();
    this.crumbService.invalidate();
    this.clearCachedCrumbRequestHeaders();
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

    const authenticateHeader = error.responseHeaders?.["www-authenticate"];
    const hasAuthenticateSignal = Array.isArray(authenticateHeader)
      ? authenticateHeader.some((value) => this.hasSsoAuthenticateSignal(value))
      : this.hasSsoAuthenticateSignal(authenticateHeader);
    if (hasAuthenticateSignal) {
      return true;
    }

    const responseText = error.responseText?.toLowerCase() ?? "";
    return (
      responseText.includes("local sso session required") ||
      responseText.includes("/__sso/login") ||
      this.responseTextIncludesSsoLoginUrl(responseText)
    );
  }

  private hasSsoAuthenticateSignal(value: string | undefined): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.toLowerCase();
    return (
      normalized.includes("localsso") ||
      normalized.includes("sso") ||
      normalized.includes("saml") ||
      normalized.includes("oidc") ||
      normalized.includes("oauth")
    );
  }

  private responseTextIncludesSsoLoginUrl(responseText: string): boolean {
    if (this.currentAuthConfig?.type !== "sso" || responseText.length === 0) {
      return false;
    }

    this.ensureSsoLoginMatchers();
    if (!this.ssoLoginUrlText) {
      return false;
    }

    return (
      responseText.includes(this.ssoLoginUrlText) ||
      (this.ssoLoginPath !== undefined && responseText.includes(this.ssoLoginPath))
    );
  }

  private getBodyLength(body: string | Uint8Array): number {
    return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  }
}
