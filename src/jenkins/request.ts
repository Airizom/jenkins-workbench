import * as http from "node:http";
import * as https from "node:https";
import { PassThrough } from "node:stream";
import { JenkinsRequestError } from "./errors";
import { isAuthRedirect } from "./urls";

const DEFAULT_TIMEOUT_MS = 30000;

export interface JenkinsRequestOptions {
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
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
  body?: string;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
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
  body?: string;
  redirectCount?: number;
  authHeader?: string;
  timeoutMs?: number;
  maxBytes?: number;
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
    const canFollowRedirect = method === "GET" || method === "HEAD";
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
        if (statusCode >= 300 && statusCode < 400) {
          const location = res.headers.location;
          if (location && canFollowRedirect) {
            if (isAuthRedirect(location, url)) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins redirected to login. Check credentials or CSRF settings.",
                  statusCode
                )
              );
              return;
            }
            if ((options.redirectCount ?? 0) >= 5) {
              safeReject(new JenkinsRequestError("Too many redirects from Jenkins API."));
              return;
            }
            clearTimer();
            const nextUrl = new URL(location, url).toString();
            requestStreamInternal(nextUrl, {
              ...options,
              redirectCount: (options.redirectCount ?? 0) + 1
            })
              .then(resolve)
              .catch(reject);
            return;
          }

          if (!canFollowRedirect) {
            if (!location) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins returned a redirect without a location header.",
                  statusCode
                )
              );
              return;
            }

            if (isAuthRedirect(location, url)) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins redirected to login. Check credentials or CSRF settings.",
                  statusCode
                )
              );
              return;
            }

            safeReject(
              new JenkinsRequestError("Jenkins returned a redirect that cannot be followed.")
            );
            return;
          }
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
          safeReject(
            new JenkinsRequestError(
              `Response exceeded max download size (${maxBytes} bytes).`,
              statusCode
            )
          );
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
            stream.destroy(
              new JenkinsRequestError(
                `Response exceeded max download size (${maxBytes} bytes).`,
                statusCode
              )
            );
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
    const canFollowRedirect = method === "GET" || method === "HEAD";
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
        if (statusCode >= 300 && statusCode < 400) {
          const location = res.headers.location;
          if (location && canFollowRedirect) {
            if (isAuthRedirect(location, url)) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins redirected to login. Check credentials or CSRF settings.",
                  statusCode
                )
              );
              return;
            }
            if ((options.redirectCount ?? 0) >= 5) {
              safeReject(new JenkinsRequestError("Too many redirects from Jenkins API."));
              return;
            }
            clearTimer();
            const nextUrl = new URL(location, url).toString();
            request<T>(nextUrl, {
              ...options,
              redirectCount: (options.redirectCount ?? 0) + 1
            })
              .then(resolve)
              .catch(reject);
            return;
          }

          if (!canFollowRedirect) {
            if (!location) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins returned a redirect without a location header.",
                  statusCode
                )
              );
              return;
            }

            if (isAuthRedirect(location, url)) {
              safeReject(
                new JenkinsRequestError(
                  "Jenkins redirected to login. Check credentials or CSRF settings.",
                  statusCode
                )
              );
              return;
            }

            if (!options.parseJson) {
              if (options.returnHeaders || options.returnText || options.returnBuffer) {
                let raw = "";
                const maxBytes = normalizeMaxBytes(options.maxBytes);
                const maxLength = maxBytes ?? Number.POSITIVE_INFINITY;
                let receivedBytes = 0;
                const contentLength = parseContentLength(res.headers["content-length"]);
                if (
                  maxBytes !== undefined &&
                  contentLength !== undefined &&
                  contentLength > maxBytes
                ) {
                  safeReject(
                    new JenkinsRequestError(
                      `Response exceeded max download size (${maxBytes} bytes).`,
                      statusCode
                    )
                  );
                  res.destroy();
                  return;
                }
                const chunks: Buffer[] = [];
                if (options.returnText) {
                  res.setEncoding("utf8");
                }
                res.on("data", (chunk) => {
                  if (options.returnBuffer) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    receivedBytes += buffer.length;
                    if (receivedBytes > maxLength) {
                      safeReject(
                        new JenkinsRequestError(
                          `Response exceeded max download size (${maxLength} bytes).`,
                          statusCode
                        )
                      );
                      res.destroy();
                      return;
                    }
                    chunks.push(buffer);
                  } else if (options.returnText) {
                    raw += chunk;
                  }
                });
                res.on("end", () => {
                  if (options.returnHeaders) {
                    if (options.returnBuffer) {
                      safeResolve({ data: Buffer.concat(chunks), headers: res.headers } as T);
                      return;
                    }
                    if (options.returnText) {
                      safeResolve({ text: raw, headers: res.headers } as T);
                      return;
                    }
                    safeResolve(res.headers as T);
                    return;
                  }
                  if (options.returnBuffer) {
                    safeResolve(Buffer.concat(chunks) as T);
                    return;
                  }
                  safeResolve(raw as T);
                });
                return;
              }

              safeResolve(undefined as T);
              return;
            }
          }
        }

        let raw = "";
        const chunks: Buffer[] = [];
        const maxBytes = normalizeMaxBytes(options.maxBytes);
        const maxLength = maxBytes ?? Number.POSITIVE_INFINITY;
        let receivedBytes = 0;
        const contentLength = parseContentLength(res.headers["content-length"]);
        if (options.returnBuffer && maxBytes !== undefined && contentLength !== undefined) {
          if (contentLength > maxBytes) {
            safeReject(
              new JenkinsRequestError(
                `Response exceeded max download size (${maxBytes} bytes).`,
                statusCode
              )
            );
            res.destroy();
            return;
          }
        }

        if (!options.returnBuffer) {
          res.setEncoding("utf8");
        }
        res.on("data", (chunk) => {
          if (options.returnBuffer) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buffer.length;
            if (receivedBytes > maxLength) {
              safeReject(
                new JenkinsRequestError(
                  `Response exceeded max download size (${maxLength} bytes).`,
                  statusCode
                )
              );
              res.destroy();
              return;
            }
            chunks.push(buffer);
            return;
          }
          raw += chunk;
        });
        res.on("end", () => {
          if (statusCode < 200 || statusCode >= 300) {
            safeReject(
              new JenkinsRequestError(
                `Jenkins API request failed (${statusCode} ${res.statusMessage ?? ""})`,
                statusCode
              )
            );
            return;
          }

          if (options.returnHeaders) {
            if (options.returnBuffer) {
              safeResolve({ data: Buffer.concat(chunks), headers: res.headers } as T);
              return;
            }
            if (options.returnText) {
              safeResolve({ text: raw, headers: res.headers } as T);
              return;
            }
            safeResolve(res.headers as T);
            return;
          }

          if (!options.parseJson) {
            if (options.returnBuffer) {
              safeResolve(Buffer.concat(chunks) as T);
              return;
            }
            if (options.returnText) {
              safeResolve(raw as T);
              return;
            }
            safeResolve(undefined as T);
            return;
          }

          try {
            safeResolve(JSON.parse(raw) as T);
          } catch (error) {
            safeReject(
              new JenkinsRequestError(
                `Failed to parse Jenkins response: ${(error as Error).message}`
              )
            );
          }
        });
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
