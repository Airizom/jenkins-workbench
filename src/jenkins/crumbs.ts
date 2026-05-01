import type { IncomingHttpHeaders } from "node:http";
import { buildApiUrlFromBase } from "./urls";

export interface JenkinsCrumbHeader {
  field: string;
  value: string;
  cookie?: string;
}

const CRUMB_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

interface JenkinsCrumbResponse {
  crumbRequestField?: string;
  crumb?: string;
}

interface JenkinsCrumbFetchResult {
  body: JenkinsCrumbResponse;
  headers?: IncomingHttpHeaders;
}

export class JenkinsCrumbService {
  private crumbHeader?: JenkinsCrumbHeader;
  private crumbFetchAttempted = false;
  private crumbFetchedAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchCrumb: (url: string) => Promise<JenkinsCrumbFetchResult>
  ) {}

  async getCrumbHeader(force = false): Promise<JenkinsCrumbHeader | undefined> {
    const now = Date.now();
    const isExpired =
      this.crumbFetchedAt > 0 && now - this.crumbFetchedAt > CRUMB_REFRESH_INTERVAL_MS;

    if (this.crumbHeader && !force && !isExpired) {
      return this.crumbHeader;
    }

    if (this.crumbFetchAttempted && !force && !isExpired) {
      return undefined;
    }

    this.crumbFetchAttempted = true;

    try {
      const url = buildApiUrlFromBase(this.baseUrl, "crumbIssuer/api/json");
      const { body: response, headers } = await this.fetchCrumb(url);
      if (response.crumbRequestField && response.crumb) {
        this.crumbHeader = {
          field: response.crumbRequestField,
          value: response.crumb,
          cookie: buildCookieHeader(headers?.["set-cookie"])
        };
        this.crumbFetchedAt = now;
        return this.crumbHeader;
      }
    } catch {
      this.crumbHeader = undefined;
      this.crumbFetchedAt = 0;
      return undefined;
    }

    return undefined;
  }

  invalidate(): void {
    this.crumbHeader = undefined;
    this.crumbFetchAttempted = false;
    this.crumbFetchedAt = 0;
  }
}

function buildCookieHeader(setCookie: string | string[] | undefined): string | undefined {
  const rawCookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookies = rawCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}
