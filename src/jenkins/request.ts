import * as http from "node:http";
import * as https from "node:https";
import { PassThrough } from "node:stream";
import { JenkinsMaxBytesError, JenkinsRequestError } from "./errors";
import { isAuthRedirect } from "./urls";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

function resolveRedirectLocation(
  location: string | string[] | undefined,
  baseUrl: string
): string | undefined {
  const rawLocation = Array.isArray(location) ? location.at(0) : location;
  if (!rawLocation) {
    return undefined;
  }
  try {
    return new URL(rawLocation, baseUrl).toString();
  } catch {
    return undefined;
  }
}

type RedirectDecision =
  | {
      type: "none";
    }
  | {
      type: "follow";
      nextUrl: string;
      redirectCount: number;
    }
  | {
      type: "cannotFollow";
    }
  | {
      type: "reject";
      error: JenkinsRequestError;
    };

interface RedirectDecisionInput {
  statusCode: number;
  method: "GET" | "POST" | "HEAD";
  location: string | string[] | undefined;
  currentUrl: string;
  redirectCount: number;
}

function decideRedirect({
  statusCode,
  method,
  location,
  currentUrl,
  redirectCount
}: RedirectDecisionInput): RedirectDecision {
  if (statusCode < 300 || statusCode >= 400) {
    return { type: "none" };
  }

  const canFollowRedirect = method === "GET" || method === "HEAD";
  if (location === undefined) {
    if (canFollowRedirect) {
      return { type: "none" };
    }
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins returned a redirect without a location header.",
        statusCode
      )
    };
  }

  const nextUrl = resolveRedirectLocation(location, currentUrl);
  if (!nextUrl) {
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins returned an invalid redirect location header.",
        statusCode
      )
    };
  }

  if (isAuthRedirect(nextUrl, currentUrl)) {
    return {
      type: "reject",
      error: new JenkinsRequestError(
        "Jenkins redirected to login. Check credentials or CSRF settings.",
        statusCode
      )
    };
  }

  if (!canFollowRedirect) {
    return { type: "cannotFollow" };
  }

  if (redirectCount >= MAX_REDIRECTS) {
    return {
      type: "reject",
      error: new JenkinsRequestError("Too many redirects from Jenkins API.")
    };
  }

  return {
    type: "follow",
    nextUrl,
    redirectCount: redirectCount + 1
  };
}

export interface JenkinsRequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  parseJson: boolean;
  returnText?: boolean;
  returnBuffer?: boolean;
  returnHeaders?: boolean;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface JenkinsTextResponse {
  text: string;
  headers: http.IncomingHttpHeaders;
}

export interface JenkinsBufferResponse {
  data: Uint8Array;
  headers: http.IncomingHttpHeaders;
}

export interface JenkinsStreamResponse {
  stream: NodeJS.ReadableStream;
  headers: http.IncomingHttpHeaders;
}

export interface JenkinsVoidRequestOptions {
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
}

export interface JenkinsTextRequestOptions {
  method: "POST" | "GET" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface JenkinsSimpleRequestOptions {
  authHeader?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

export async function requestJson<T>(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<T> {
  return request<T>(url, {
    parseJson: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs
  });
}

export async function requestText(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<string> {
  return request<string>(url, {
    parseJson: false,
    returnText: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs
  });
}

export async function requestTextWithOptions(
  url: string,
  options: JenkinsTextRequestOptions
): Promise<string> {
  return request<string>(url, {
    method: options.method,
    parseJson: false,
    returnText: true,
    headers: options.headers,
    body: options.body,
    redirectCount: options.redirectCount,
    authHeader: options.authHeader,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes
  });
}

export async function requestTextWithHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsTextResponse> {
  return request<JenkinsTextResponse>(url, {
    parseJson: false,
    returnText: true,
    returnHeaders: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs
  });
}

export async function requestBufferWithHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsBufferResponse> {
  return request<JenkinsBufferResponse>(url, {
    parseJson: false,
    returnBuffer: true,
    returnHeaders: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs,
    maxBytes: options?.maxBytes
  });
}

export async function requestStream(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsStreamResponse> {
  return requestStreamInternal(url, {
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs,
    maxBytes: options?.maxBytes
  });
}

export async function requestHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<http.IncomingHttpHeaders> {
  return request<http.IncomingHttpHeaders>(url, {
    method: "HEAD",
    parseJson: false,
    returnHeaders: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs
  });
}

export async function requestVoid(url: string, options: JenkinsVoidRequestOptions): Promise<void> {
  await request<void>(url, { ...options, parseJson: false });
}

export interface JenkinsPostResponse {
  location?: string;
}

export async function requestVoidWithLocation(
  url: string,
  options: JenkinsVoidRequestOptions
): Promise<JenkinsPostResponse> {
  const result = await request<JenkinsTextResponse>(url, {
    ...options,
    parseJson: false,
    returnHeaders: true,
    returnText: true
  });
  const location = result.headers.location;
  return {
    location: typeof location === "string" ? location : undefined
  };
}

interface JenkinsStreamRequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

interface JenkinsCollectedResponseBody {
  text?: string;
  buffer?: Buffer;
}

function collectResponseBody(
  res: http.IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions
): Promise<JenkinsCollectedResponseBody> {
  const collectBuffer = options.returnBuffer === true;
  const maxBytes = collectBuffer ? normalizeMaxBytes(options.maxBytes) : undefined;
  const contentLength = parseContentLength(res.headers["content-length"]);
  if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
    res.destroy();
    return Promise.reject(new JenkinsMaxBytesError(maxBytes, statusCode));
  }

  return new Promise<JenkinsCollectedResponseBody>((resolve, reject) => {
    let settled = false;
    const safeResolve = (value: JenkinsCollectedResponseBody): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const safeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    if (collectBuffer) {
      const maxLength = maxBytes ?? Number.POSITIVE_INFINITY;
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      res.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxLength) {
          safeReject(new JenkinsMaxBytesError(maxLength, statusCode));
          res.destroy();
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        safeResolve({ buffer: Buffer.concat(chunks) });
      });
      res.on("error", (error) => {
        safeReject(error instanceof Error ? error : new Error(String(error)));
      });
      return;
    }

    let text = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      text += chunk;
    });
    res.on("end", () => {
      safeResolve({ text });
    });
    res.on("error", (error) => {
      safeReject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function materializeResponse<T>(
  options: JenkinsRequestOptions,
  res: http.IncomingMessage,
  body: JenkinsCollectedResponseBody
): T {
  if (options.returnHeaders) {
    if (options.returnBuffer) {
      return { data: body.buffer ?? Buffer.alloc(0), headers: res.headers } as T;
    }
    if (options.returnText) {
      return { text: body.text ?? "", headers: res.headers } as T;
    }
    return res.headers as T;
  }

  if (!options.parseJson) {
    if (options.returnBuffer) {
      return (body.buffer ?? Buffer.alloc(0)) as T;
    }
    if (options.returnText) {
      return (body.text ?? "") as T;
    }
    return undefined as T;
  }

  return JSON.parse(body.text ?? "") as T;
}

function getResponseTextForError(
  options: JenkinsRequestOptions,
  body: JenkinsCollectedResponseBody
): string | undefined {
  if (!options.returnText || options.returnBuffer) {
    return undefined;
  }
  return body.text ?? "";
}

type RequestResponseStatusPolicy = "requireSuccessStatus" | "skipStatusCheck";

type RequestResponsePlan =
  | {
      type: "resolveImmediately";
    }
  | {
      type: "collectAndMaterialize";
      statusPolicy: RequestResponseStatusPolicy;
    };

type RequestRedirectResolution =
  | {
      type: "reject";
      error: JenkinsRequestError;
    }
  | {
      type: "follow";
      nextUrl: string;
      redirectCount: number;
    }
  | {
      type: "continue";
    };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isSuccessStatusCode(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function buildStatusCodeError(
  statusCode: number,
  statusMessage: string | undefined,
  responseText?: string
): JenkinsRequestError {
  return new JenkinsRequestError(
    `Jenkins API request failed (${statusCode} ${statusMessage ?? ""})`,
    statusCode,
    responseText
  );
}

function resolveRequestRedirect(redirectDecision: RedirectDecision): RequestRedirectResolution {
  if (redirectDecision.type === "reject") {
    return {
      type: "reject",
      error: redirectDecision.error
    };
  }
  if (redirectDecision.type === "follow") {
    return {
      type: "follow",
      nextUrl: redirectDecision.nextUrl,
      redirectCount: redirectDecision.redirectCount
    };
  }
  return { type: "continue" };
}

function resolveResponseStatusPolicy(
  options: JenkinsRequestOptions,
  redirectDecision: RedirectDecision
): RequestResponseStatusPolicy {
  if (
    redirectDecision.type === "cannotFollow" &&
    !options.parseJson &&
    (options.returnHeaders || options.returnText || options.returnBuffer)
  ) {
    return "skipStatusCheck";
  }
  return "requireSuccessStatus";
}

function buildRequestResponsePlan(
  options: JenkinsRequestOptions,
  redirectDecision: RedirectDecision
): RequestResponsePlan {
  const statusPolicy = resolveResponseStatusPolicy(options, redirectDecision);
  if (
    redirectDecision.type === "cannotFollow" &&
    statusPolicy === "requireSuccessStatus" &&
    !options.parseJson
  ) {
    return { type: "resolveImmediately" };
  }
  return {
    type: "collectAndMaterialize",
    statusPolicy
  };
}

async function decodeAndMaterializeResponse<T>(
  res: http.IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions,
  statusPolicy: RequestResponseStatusPolicy
): Promise<T> {
  const body = await collectResponseBody(res, statusCode, options);
  if (statusPolicy === "requireSuccessStatus" && !isSuccessStatusCode(statusCode)) {
    throw buildStatusCodeError(
      statusCode,
      res.statusMessage,
      getResponseTextForError(options, body)
    );
  }

  try {
    return materializeResponse<T>(options, res, body);
  } catch (error) {
    throw new JenkinsRequestError(`Failed to parse Jenkins response: ${toError(error).message}`);
  }
}

function requestStreamInternal(
  url: string,
  options: JenkinsStreamRequestOptions
): Promise<JenkinsStreamResponse> {
  const headers: Record<string, string> = {
    Accept: "*/*",
    ...options.headers
  };

  if (options.authHeader) {
    headers.Authorization = options.authHeader;
  }

  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<JenkinsStreamResponse>((resolve, reject) => {
    const method = options.method ?? "GET";
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimer = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const safeResolve = (value: JenkinsStreamResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      resolve(value);
    };

    const safeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      reject(error);
    };

    const req = client.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        timeout: timeoutMs
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const redirectDecision = decideRedirect({
          statusCode,
          method,
          location: res.headers.location,
          currentUrl: url,
          redirectCount: options.redirectCount ?? 0
        });
        if (redirectDecision.type === "reject") {
          safeReject(redirectDecision.error);
          return;
        }
        if (redirectDecision.type === "follow") {
          clearTimer();
          requestStreamInternal(redirectDecision.nextUrl, {
            ...options,
            redirectCount: redirectDecision.redirectCount
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        if (redirectDecision.type === "cannotFollow") {
          safeReject(
            new JenkinsRequestError("Jenkins returned a redirect that cannot be followed.")
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          safeReject(
            new JenkinsRequestError(
              `Jenkins API request failed (${statusCode} ${res.statusMessage ?? ""})`,
              statusCode
            )
          );
          res.resume();
          return;
        }

        const maxBytes = normalizeMaxBytes(options.maxBytes);
        const contentLength = parseContentLength(res.headers["content-length"]);
        if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
          safeReject(new JenkinsMaxBytesError(maxBytes, statusCode));
          res.destroy();
          return;
        }

        const stream = new PassThrough();
        let receivedBytes = 0;
        res.on("data", (chunk) => {
          if (maxBytes === undefined) {
            return;
          }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > maxBytes) {
            stream.destroy(new JenkinsMaxBytesError(maxBytes, statusCode));
            res.destroy();
          }
        });
        res.on("error", (error) => {
          stream.destroy(error instanceof Error ? error : new Error(String(error)));
        });
        res.pipe(stream);
        safeResolve({ stream, headers: res.headers });
      }
    );

    req.on("error", (error) => {
      safeReject(error instanceof Error ? error : new Error(String(error)));
    });

    req.on("timeout", () => {
      req.destroy();
      safeReject(new JenkinsRequestError(`Request timed out after ${timeoutMs}ms`));
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        req.destroy();
        safeReject(new JenkinsRequestError(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    if (options.body !== undefined) {
      req.write(options.body);
    }

    req.end();
  });
}

export async function request<T>(url: string, options: JenkinsRequestOptions): Promise<T> {
  const headers: Record<string, string> = {
    Accept: options.parseJson ? "application/json" : "*/*",
    ...options.headers
  };

  if (options.authHeader) {
    headers.Authorization = options.authHeader;
  }

  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    const method = options.method ?? "GET";
    let timeoutId: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimer = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const safeResolve = (value: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      resolve(value);
    };

    const safeReject = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      reject(error);
    };

    const req = client.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        timeout: timeoutMs
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        const redirectDecision = decideRedirect({
          statusCode,
          method,
          location: res.headers.location,
          currentUrl: url,
          redirectCount: options.redirectCount ?? 0
        });
        const redirectResolution = resolveRequestRedirect(redirectDecision);
        if (redirectResolution.type === "reject") {
          safeReject(redirectResolution.error);
          return;
        }
        if (redirectResolution.type === "follow") {
          clearTimer();
          request<T>(redirectResolution.nextUrl, {
            ...options,
            redirectCount: redirectResolution.redirectCount
          })
            .then(resolve)
            .catch(reject);
          return;
        }
        const responsePlan = buildRequestResponsePlan(options, redirectDecision);
        if (responsePlan.type === "resolveImmediately") {
          safeResolve(undefined as T);
          return;
        }

        decodeAndMaterializeResponse<T>(res, statusCode, options, responsePlan.statusPolicy)
          .then((result) => {
            safeResolve(result);
          })
          .catch((error) => {
            safeReject(toError(error));
          });
      }
    );

    req.on("error", (error) => {
      safeReject(toError(error));
    });

    req.on("timeout", () => {
      req.destroy();
      safeReject(new JenkinsRequestError(`Request timed out after ${timeoutMs}ms`));
    });

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        req.destroy();
        safeReject(new JenkinsRequestError(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    if (options.body !== undefined) {
      req.write(options.body);
    }

    req.end();
  });
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeMaxBytes(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}
