import type { IncomingHttpHeaders } from "node:http";
import { request as requestInternal } from "./request/standardRequest";
import { requestStream as requestStreamInternal } from "./request/streamRequest";
import type {
  JenkinsBufferResponse,
  JenkinsPostResponse,
  JenkinsRequestOptions,
  JenkinsSimpleRequestOptions,
  JenkinsStreamResponse,
  JenkinsTextRequestOptions,
  JenkinsTextResponse,
  JenkinsVoidRequestOptions
} from "./request/types";

export type {
  JenkinsBufferResponse,
  JenkinsPostResponse,
  JenkinsRequestOptions,
  JenkinsSimpleRequestOptions,
  JenkinsStreamResponse,
  JenkinsTextRequestOptions,
  JenkinsTextResponse,
  JenkinsVoidRequestOptions
} from "./request/types";

export async function requestJson<T>(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<T> {
  return requestInternal<T>(url, {
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
  return requestInternal<string>(url, {
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
  return requestInternal<string>(url, {
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
  return requestInternal<JenkinsTextResponse>(url, {
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
  return requestInternal(url, {
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
): Promise<IncomingHttpHeaders> {
  return requestInternal<IncomingHttpHeaders>(url, {
    method: "HEAD",
    parseJson: false,
    returnHeaders: true,
    authHeader: options?.authHeader,
    headers: options?.headers,
    timeoutMs: options?.timeoutMs
  });
}

export async function requestVoid(url: string, options: JenkinsVoidRequestOptions): Promise<void> {
  await requestInternal<void>(url, { ...options, parseJson: false });
}

export async function requestVoidWithLocation(
  url: string,
  options: JenkinsVoidRequestOptions
): Promise<JenkinsPostResponse> {
  const result = await requestInternal<JenkinsTextResponse>(url, {
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

export async function request<T>(url: string, options: JenkinsRequestOptions): Promise<T> {
  return requestInternal<T>(url, options);
}
