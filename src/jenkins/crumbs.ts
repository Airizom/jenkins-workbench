import { buildApiUrlFromBase } from "./urls";

export interface JenkinsCrumbHeader {
  field: string;
  value: string;
}

const CRUMB_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export class JenkinsCrumbService {
  private crumbHeader?: JenkinsCrumbHeader;
  private crumbFetchAttempted = false;
  private crumbFetchedAt = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly requestJson: <T>(url: string) => Promise<T>
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
      const response = await this.requestJson<{
        crumbRequestField?: string;
        crumb?: string;
      }>(url);
      if (response.crumbRequestField && response.crumb) {
        this.crumbHeader = {
          field: response.crumbRequestField,
          value: response.crumb
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
