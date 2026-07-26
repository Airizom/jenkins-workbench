import type { IncomingHttpHeaders } from "node:http";
import { request as requestInternal } from "./request/standardRequest";
import { requestJenkinsStream } from "./request/streamRequest";
import type {
  JenkinsBufferResponse,
  JenkinsPostResponse,
  JenkinsSimpleRequestOptions,
  JenkinsStreamResponse,
  JenkinsTextRequestOptions,
  JenkinsTextResponse,
  JenkinsVoidRequestOptions
} from "./request/types";

export type {
  JenkinsBufferResponse,
  JenkinsPostResponse,
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
    ...options,
    parseJson: true
  });
}

export async function requestText(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<string> {
  return requestInternal<string>(url, {
    ...options,
    parseJson: false,
    returnText: true
  });
}

export async function requestTextWithOptions(
  url: string,
  options: JenkinsTextRequestOptions
): Promise<string> {
  return requestInternal<string>(url, {
    ...options,
    parseJson: false,
    returnText: true
  });
}

export async function requestTextWithHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsTextResponse> {
  return requestInternal<JenkinsTextResponse>(url, {
    ...options,
    parseJson: false,
    returnText: true,
    returnHeaders: true
  });
}

export async function requestBufferWithHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsBufferResponse> {
  return requestInternal(url, {
    ...options,
    parseJson: false,
    returnBuffer: true,
    returnHeaders: true
  });
}

export async function requestStream(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<JenkinsStreamResponse> {
  return requestJenkinsStream(url, { ...options });
}

export async function requestHeaders(
  url: string,
  options?: JenkinsSimpleRequestOptions
): Promise<IncomingHttpHeaders> {
  return requestInternal<IncomingHttpHeaders>(url, {
    ...options,
    method: "HEAD",
    parseJson: false,
    returnHeaders: true
  });
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
