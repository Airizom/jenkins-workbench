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
  baseHeaders?: Record<string, string>
): Record<string, string> {
  const headers = { ...baseHeaders, ...contentHeaders };
  if (!crumbHeader) {
    return headers;
  }

  headers[crumbHeader.field] = crumbHeader.value;

  if (crumbHeader.cookie) {
    const cookieHeaders: string[] = [];
    for (const source of [baseHeaders, contentHeaders]) {
      for (const [name, value] of Object.entries(source ?? {})) {
        if (name.toLowerCase() === "cookie") {
          cookieHeaders.push(value);
          delete headers[name];
        }
      }
    }
    // The crumb response owns the session cookie, including after a refresh.
    cookieHeaders.push(crumbHeader.cookie);
    const cookies = new Map<string, string>();
    for (const value of cookieHeaders) {
      for (const part of value.split(";")) {
        const cookie = part.trim();
        const separator = cookie.indexOf("=");
        if (separator > 0) {
          cookies.set(cookie.slice(0, separator).trim(), cookie);
        }
      }
    }
    headers.Cookie = [...cookies.values()].join("; ");
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
