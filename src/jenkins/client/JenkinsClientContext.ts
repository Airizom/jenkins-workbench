import type { IncomingHttpHeaders } from "node:http";
import type { JenkinsBufferResponse, JenkinsPostResponse, JenkinsStreamResponse } from "../request";

export interface JenkinsClientContext {
  baseUrl: string;
  requestJson<T>(url: string): Promise<T>;
  requestHeaders(url: string): Promise<IncomingHttpHeaders>;
  requestText(url: string): Promise<string>;
  requestTextWithHeaders(
    url: string,
    options?: { headers?: Record<string, string> }
  ): Promise<{ text: string; headers: IncomingHttpHeaders }>;
  requestBufferWithHeaders(
    url: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse>;
  requestStream(url: string, options?: { maxBytes?: number }): Promise<JenkinsStreamResponse>;
  requestVoidWithCrumb(url: string, body?: string): Promise<void>;
  requestPostWithCrumb(url: string, body?: string): Promise<JenkinsPostResponse>;
  requestPostWithCrumbRaw(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<JenkinsPostResponse>;
  requestPostTextWithCrumbRaw(
    url: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<string>;
}
