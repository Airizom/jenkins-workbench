import type { JenkinsCrumbHeader } from "../crumbs";

const EMPTY_HEADERS: Record<string, string> = {};

export function buildContentHeaders(body: string | Uint8Array | undefined): Record<string, string> {
  if (body === undefined) {
    return EMPTY_HEADERS;
  }

  const contentLength = getBodyLength(body).toString();
  return typeof body === "string"
    ? {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": contentLength
      }
    : { "Content-Length": contentLength };
}

export function buildRawContentHeaders(
  body: string | Uint8Array,
  headers?: Record<string, string>
): Record<string, string> {
  if (!headers) {
    return { "Content-Length": getBodyLength(body).toString() };
  }

  const contentHeaders: Record<string, string> = { ...headers };
  if (!("Content-Length" in contentHeaders)) {
    contentHeaders["Content-Length"] = getBodyLength(body).toString();
  }
  return contentHeaders;
}

export function buildHeadersWithCrumb(
  contentHeaders: Record<string, string>,
  crumbHeader: JenkinsCrumbHeader | undefined,
  baseHeadersHaveCookie: boolean
): Record<string, string> {
  if (!crumbHeader) {
    return contentHeaders;
  }

  const headers = {
    ...contentHeaders,
    [crumbHeader.field]: crumbHeader.value
  };

  if (crumbHeader.cookie && !baseHeadersHaveCookie && !getHeaderFlags(contentHeaders).hasCookie) {
    headers.Cookie = crumbHeader.cookie;
  }

  return headers;
}

export function getHeaderFlags(headers: Record<string, string> | undefined): {
  hasHeaders: boolean;
  hasCookie: boolean;
} {
  if (!headers) {
    return { hasHeaders: false, hasCookie: false };
  }

  let hasHeaders = false;
  for (const key in headers) {
    if (Object.hasOwn(headers, key)) {
      hasHeaders = true;
      if (key.toLowerCase() === "cookie") {
        return { hasHeaders: true, hasCookie: true };
      }
    }
  }
  return { hasHeaders, hasCookie: false };
}

function getBodyLength(body: string | Uint8Array): number {
  return typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
}
