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
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
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
  abort(): void;
}

export interface JenkinsVoidRequestOptions {
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
}

export interface JenkinsTextRequestOptions {
  method: "POST" | "GET" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
}

export interface JenkinsSimpleRequestOptions {
  authHeader?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
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
  /** Jenkins environment URL; its path is the context path, not a route marker. */
  contextUrl?: string;
  maxBytes?: number;
}

export interface JenkinsCollectedResponseBody {
  text?: string;
  buffer?: Buffer;
}
