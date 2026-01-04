import type { IncomingHttpHeaders } from "node:http";
import type { JenkinsPostResponse } from "../request";

export interface JenkinsClientContext {
  baseUrl: string;
  requestJson<T>(url: string): Promise<T>;
  requestHeaders(url: string): Promise<IncomingHttpHeaders>;
  requestText(url: string): Promise<string>;
  requestTextWithHeaders(url: string): Promise<{ text: string; headers: IncomingHttpHeaders }>;
  requestVoidWithCrumb(url: string, body?: string): Promise<void>;
  requestPostWithCrumb(url: string, body?: string): Promise<JenkinsPostResponse>;
}
