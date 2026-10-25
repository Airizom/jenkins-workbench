import type { IncomingMessage } from "node:http";
import { JenkinsRequestError } from "../errors";
import type { RedirectDecision } from "./redirects";
import {
  collectBoundedResponseBuffer,
  collectBoundedResponseText,
  normalizeMaxBytes
} from "./responseLimits";
import { toError } from "./transport";
import type { JenkinsCollectedResponseBody, JenkinsRequestOptions } from "./types";

export type RequestResponseStatusPolicy = "requireSuccessStatus" | "skipStatusCheck";

export type RequestResponsePlan =
  | {
      type: "resolveImmediately";
    }
  | {
      type: "collectAndMaterialize";
      statusPolicy: RequestResponseStatusPolicy;
    };

export function isSuccessStatusCode(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

export function buildStatusCodeError(
  statusCode: number,
  statusMessage: string | undefined,
  responseText?: string,
  responseHeaders?: IncomingMessage["headers"]
): JenkinsRequestError {
  return new JenkinsRequestError(
    `Jenkins API request failed (${statusCode} ${statusMessage ?? ""})`,
    statusCode,
    responseText,
    responseHeaders
  );
}

export { parseContentLength } from "./responseLimits";

function collectResponseBody(
  res: IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions
): Promise<JenkinsCollectedResponseBody> {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  if (options.returnBuffer === true) {
    return collectBoundedResponseBuffer(res, statusCode, maxBytes).then((buffer) => ({ buffer }));
  }

  return collectBoundedResponseText(res, statusCode, maxBytes, "reject").then((text) => ({ text }));
}

function materializeResponse<T>(
  options: JenkinsRequestOptions,
  res: IncomingMessage,
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
  if (options.returnBuffer) {
    return undefined;
  }
  return body.text ?? "";
}

export function buildRequestResponsePlan(
  options: JenkinsRequestOptions,
  redirectDecision: RedirectDecision
): RequestResponsePlan {
  if (redirectDecision.type === "cannotFollow" && !options.parseJson) {
    if (options.returnHeaders || options.returnText || options.returnBuffer) {
      return { type: "collectAndMaterialize", statusPolicy: "skipStatusCheck" };
    }
    return { type: "resolveImmediately" };
  }
  return { type: "collectAndMaterialize", statusPolicy: "requireSuccessStatus" };
}

export async function decodeAndMaterializeResponse<T>(
  res: IncomingMessage,
  statusCode: number,
  options: JenkinsRequestOptions,
  statusPolicy: RequestResponseStatusPolicy
): Promise<T> {
  const body = await collectResponseBody(res, statusCode, options);
  if (statusPolicy === "requireSuccessStatus" && !isSuccessStatusCode(statusCode)) {
    throw buildStatusCodeError(
      statusCode,
      res.statusMessage,
      getResponseTextForError(options, body),
      res.headers
    );
  }

  try {
    return materializeResponse<T>(options, res, body);
  } catch (error) {
    throw new JenkinsRequestError(`Failed to parse Jenkins response: ${toError(error).message}`);
  }
}
