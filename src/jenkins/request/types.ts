import type { IncomingHttpHeaders } from "node:http";

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
  headers: IncomingHttpHeaders;
}

export interface JenkinsBufferResponse {
  data: Uint8Array;
  headers: IncomingHttpHeaders;
}

export interface JenkinsStreamResponse {
  stream: NodeJS.ReadableStream;
  headers: IncomingHttpHeaders;
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

export interface JenkinsPostResponse {
  location?: string;
}

export interface JenkinsStreamRequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface JenkinsCollectedResponseBody {
  text?: string;
  buffer?: Buffer;
}
