import { PassThrough } from "node:stream";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../errors";
import { normalizeMaxBytes, parseContentLength } from "./responses";
import { buildRequestHeaders } from "./transport";
import type { JenkinsStreamRequestOptions, JenkinsStreamResponse } from "./types";
import { executeRequestLifecycle } from "./requestLifecycle";

export function requestStream(
  url: string,
  options: JenkinsStreamRequestOptions
): Promise<JenkinsStreamResponse> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);

  return executeRequestLifecycle<JenkinsStreamRequestOptions, JenkinsStreamResponse>({
    url,
    options,
    buildHeaders: (requestOptions) =>
      buildRequestHeaders({
        headers: requestOptions.headers,
        authHeader: requestOptions.authHeader
      }),
    resolveRedirectAction: ({ redirectDecision }) => {
      if (redirectDecision.type === "cannotFollow") {
        return {
          type: "abort",
          error: new JenkinsRequestError("Jenkins returned a redirect that cannot be followed.")
        };
      }
      if (redirectDecision.type === "reject") {
        return {
          type: "abort",
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
      return { type: "continue" } as const;
    },
    onResponse: ({ response, statusCode }) => {
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        return Promise.reject(
          new JenkinsRequestError(
            `Jenkins API request failed (${statusCode} ${response.statusMessage ?? ""})`,
            statusCode
          )
        );
      }

      const contentLength = parseContentLength(response.headers["content-length"]);
      if (maxBytes !== undefined && contentLength !== undefined && contentLength > maxBytes) {
        response.destroy();
        return Promise.reject(new JenkinsMaxBytesError(maxBytes, statusCode));
      }

      const stream = new PassThrough();
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        if (maxBytes === undefined) {
          return;
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxBytes) {
          stream.destroy(new JenkinsMaxBytesError(maxBytes, statusCode));
          response.destroy();
        }
      });
      response.on("error", (error) => {
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      });
      response.pipe(stream);
      return Promise.resolve({ stream, headers: response.headers });
    }
  });
}
