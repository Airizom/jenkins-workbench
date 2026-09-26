import type { IncomingHttpHeaders } from "node:http";
import { JenkinsRequestError } from "./errors";
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
  private crumbFetchPromise?: Promise<JenkinsCrumbHeader | undefined>;
  private crumbFetchAttempted = false;
  private crumbFetchedAt = 0;
  private crumbFetchGeneration = 0;

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

    if (this.crumbFetchPromise && !force) {
      return this.crumbFetchPromise;
    }

    if (this.crumbFetchAttempted && !force && !isExpired) {
      return undefined;
    }

    this.crumbFetchAttempted = true;
    const generation = ++this.crumbFetchGeneration;
    const crumbFetchPromise = this.fetchAndCacheCrumb(now, generation);
    this.crumbFetchPromise = crumbFetchPromise;

    try {
      return await crumbFetchPromise;
    } finally {
      if (this.crumbFetchPromise === crumbFetchPromise) {
        this.crumbFetchPromise = undefined;
      }
    }
  }

  invalidate(): void {
    this.crumbFetchGeneration += 1;
    this.crumbHeader = undefined;
    this.crumbFetchPromise = undefined;
    this.crumbFetchAttempted = false;
    this.crumbFetchedAt = 0;
  }

  private async fetchAndCacheCrumb(
    fetchedAt: number,
    generation: number
  ): Promise<JenkinsCrumbHeader | undefined> {
    try {
      const url = buildApiUrlFromBase(this.baseUrl, "crumbIssuer/api/json");
      const { body: response, headers } = await this.fetchCrumb(url);
      // A fetch superseded by invalidate() or a newer forced fetch must not
      // overwrite the cache with an obsolete crumb.
      const isCurrent = generation === this.crumbFetchGeneration;
      if (response.crumbRequestField && response.crumb) {
        const crumbHeader: JenkinsCrumbHeader = {
          field: response.crumbRequestField,
          value: response.crumb,
          cookie: buildCookieHeader(headers?.["set-cookie"])
        };
        if (isCurrent) {
          this.crumbHeader = crumbHeader;
          this.crumbFetchedAt = fetchedAt;
        }
        return crumbHeader;
      }
      if (isCurrent) {
        this.crumbHeader = undefined;
        this.crumbFetchedAt = 0;
        this.crumbFetchAttempted = false;
      }
    } catch (error) {
      if (generation !== this.crumbFetchGeneration) {
        return undefined;
      }
      this.crumbHeader = undefined;
      this.crumbFetchedAt = 0;
      // A 404 means CSRF protection is disabled; keep crumbFetchAttempted set
      // so we do not re-probe the crumb issuer before every POST. Transient
      // errors stay retryable.
      if (!(error instanceof JenkinsRequestError && error.statusCode === 404)) {
        this.crumbFetchAttempted = false;
      }
      return undefined;
    }

    return undefined;
  }
}

function buildCookieHeader(setCookie: string | string[] | undefined): string | undefined {
  const rawCookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookies = rawCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}
