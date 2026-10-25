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
  requestVoidWithLocation as requestVoidWithLocationInternal
} from "../request";
import type { JenkinsAuthConfig, JenkinsAuthConfigRefresh, JenkinsClientOptions } from "../types";
import type { JenkinsClientContext } from "./JenkinsClientContext";
import {
  buildContentHeaders,
  buildHeadersWithCrumb,
  buildRawContentHeaders,
  getHeaderFlags
} from "./JenkinsHttpHeaders";
import { assertTrustedJenkinsRequestUrl, parseJenkinsBaseOrigin } from "./JenkinsRequestUrlPolicy";

export class JenkinsHttpClient implements JenkinsClientContext {
  public readonly baseUrl: string;
  private readonly baseOrigin: string;
  private readonly username?: string;
  private readonly token?: string;
  private readonly requestTimeoutMs?: number;
  private readonly allowInsecureTls: boolean;
  private readonly refreshAuthConfig?: JenkinsAuthConfigRefresh;
  private currentAuthConfig?: JenkinsAuthConfig;
  private baseHeaders?: Record<string, string>;
  private requestOptions!: JenkinsSimpleRequestOptions;
  private ssoLoginUrlText?: string;
  private ssoLoginPath?: string;
  private ssoLoginMatchersCached = false;
  private ssoAuthRefresh?: Promise<boolean>;
  private readonly crumbService: JenkinsCrumbService;

  constructor(options: JenkinsClientOptions) {
    this.baseUrl = options.baseUrl.trim();
    this.baseOrigin = parseJenkinsBaseOrigin(this.baseUrl);
    const username = options.username?.trim();
    const token = options.token?.trim();
    this.username = username && username.length > 0 ? username : undefined;
    this.token = token && token.length > 0 ? token : undefined;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.allowInsecureTls = options.allowInsecureTls === true;
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

  async requestJson<T>(
    url: string,
    options?: { beforeRequest?: () => void; signal?: AbortSignal }
  ): Promise<T> {
    return this.requestWithSsoRetry(url, () =>
      requestJsonInternal<T>(url, {
        ...this.getRequestOptions(),
        beforeRequest: options?.beforeRequest,
        signal: options?.signal
      })
    );
  }

  async requestHeaders(url: string): Promise<IncomingHttpHeaders> {
    return this.requestWithSsoRetry(url, () =>
      requestHeadersInternal(url, this.getRequestOptions())
    );
  }

  async requestText(url: string): Promise<string> {
    return this.requestWithSsoRetry(url, () => requestTextInternal(url, this.getRequestOptions()));
  }

  async requestTextWithHeaders(
    url: string,
    options?: { headers?: Record<string, string> }
  ): Promise<{ text: string; headers: IncomingHttpHeaders }> {
    return this.requestWithSsoRetry(url, () =>
      requestTextWithHeadersInternal(url, this.getRequestOptions(options?.headers))
    );
  }

  async requestBufferWithHeaders(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    return this.requestWithSsoRetry(url, () =>
      requestBufferWithHeadersInternal(url, this.getRequestOptions(undefined, options?.maxBytes))
    );
  }

  async requestStream(
    url: string,
    options?: { maxBytes?: number; signal?: AbortSignal }
  ): Promise<JenkinsStreamResponse> {
    return this.requestWithSsoRetry(url, () =>
      requestStreamInternal(url, {
        ...this.getRequestOptions(undefined, options?.maxBytes),
        ...(options?.signal ? { signal: options.signal } : {})
      })
    );
  }

  async requestVoidWithCrumb(url: string, body?: string | Uint8Array): Promise<void> {
    await this.requestWithSsoRetry(url, async () => {
      await this.requestPostWithCrumbInternal(url, body, buildContentHeaders(body));
    });
  }

  async requestPostWithCrumb(
    url: string,
    body?: string | Uint8Array
  ): Promise<JenkinsPostResponse> {
    return this.requestWithSsoRetry(url, () =>
      this.requestPostWithCrumbInternal(url, body, buildContentHeaders(body))
    );
  }

  async requestPostWithCrumbRaw(
    url: string,
    body: string | Uint8Array,
    headers?: Record<string, string>
  ): Promise<JenkinsPostResponse> {
    return this.requestWithSsoRetry(url, () => {
      const contentHeaders = buildRawContentHeaders(body, headers);
      return this.requestPostWithCrumbInternal(url, body, contentHeaders);
    });
  }

  async requestPostTextWithCrumbRaw(
    url: string,
    body: string | Uint8Array,
    headers?: Record<string, string>,
    options?: { acceptErrorStatuses?: number[] }
  ): Promise<string> {
    return this.requestWithSsoRetry(url, () => {
      const contentHeaders = buildRawContentHeaders(body, headers);
      return this.requestPostTextWithCrumbInternal(url, body, contentHeaders, options);
    });
  }

  private updateAuthHeaders(): void {
    const authHeaders = buildAuthHeaders(this.currentAuthConfig, {
      username: this.username,
      token: this.token
    });
    this.baseHeaders = getHeaderFlags(authHeaders.headers).hasHeaders
      ? authHeaders.headers
      : undefined;
    this.requestOptions = {
      authHeader: authHeaders.authHeader,
      headers: this.baseHeaders,
      timeoutMs: this.requestTimeoutMs,
      contextUrl: this.baseUrl,
      allowInsecureTls: this.allowInsecureTls
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

  private async requestPostWithCrumbInternal(
    url: string,
    body: string | Uint8Array | undefined,
    contentHeaders: Record<string, string>
  ): Promise<JenkinsPostResponse> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = buildHeadersWithCrumb(contentHeaders, crumbHeader, this.baseHeaders);
    return this.requestPostWithCrumbRetry(contentHeaders, headers, (requestHeaders) =>
      requestVoidWithLocationInternal(url, {
        ...this.requestOptions,
        method: "POST",
        headers: requestHeaders,
        body
      })
    );
  }

  private async requestPostTextWithCrumbInternal(
    url: string,
    body: string | Uint8Array,
    contentHeaders: Record<string, string>,
    options?: { acceptErrorStatuses?: number[] }
  ): Promise<string> {
    const crumbHeader = await this.crumbService.getCrumbHeader();
    const headers = buildHeadersWithCrumb(contentHeaders, crumbHeader, this.baseHeaders);
    try {
      return await this.requestPostWithCrumbRetry(contentHeaders, headers, (requestHeaders) =>
        requestTextInternal(url, {
          ...this.requestOptions,
          method: "POST",
          headers: requestHeaders,
          body
        })
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
        request(buildHeadersWithCrumb(contentHeaders, refreshed, this.baseHeaders))
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
      ...this.requestOptions,
      headers: this.mergeHeaders(headers)
    };
    if (maxBytes !== undefined) {
      requestOptions.maxBytes = maxBytes;
    }
    return requestOptions;
  }

  private mergeHeaders(headers?: Record<string, string>): Record<string, string> | undefined {
    const baseHeaders = this.baseHeaders;
    if (!baseHeaders) {
      return headers;
    }
    if (!headers || !getHeaderFlags(headers).hasHeaders) {
      return baseHeaders;
    }
    return {
      ...baseHeaders,
      ...headers
    };
  }

  private async retryAfterCrumbError<T>(
    error: unknown,
    retry: (refreshed: JenkinsCrumbHeader) => Promise<T>
  ): Promise<T> {
    if (error instanceof JenkinsRequestError) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        this.crumbService.invalidate();
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

  private async requestWithSsoRetry<T>(url: string, requestFn: () => Promise<T>): Promise<T> {
    assertTrustedJenkinsRequestUrl(url, this.baseOrigin);
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
    if (refreshed?.type !== "sso") {
      return false;
    }

    if (this.currentAuthConfig !== authConfig) {
      return true;
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
}
