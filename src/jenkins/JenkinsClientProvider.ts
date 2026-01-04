import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsClient } from "./JenkinsClient";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";

export interface JenkinsClientProviderOptions {
  requestTimeoutMs?: number;
}

export class JenkinsClientProvider {
  private readonly clientCache = new Map<
    string,
    {
      client: JenkinsClient;
      token?: string;
      url: string;
      username?: string;
    }
  >();
  private requestTimeoutMs?: number;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    options?: JenkinsClientProviderOptions
  ) {
    this.requestTimeoutMs = options?.requestTimeoutMs;
  }

  setRequestTimeoutMs(timeoutMs: number | undefined): void {
    this.requestTimeoutMs = timeoutMs;
    this.clientCache.clear();
  }

  async getClient(environment: JenkinsEnvironmentRef): Promise<JenkinsClient> {
    const token = await this.store.getToken(environment.scope, environment.environmentId);

    const cacheKey = `${environment.scope}:${environment.environmentId}`;
    const cached = this.clientCache.get(cacheKey);

    if (
      cached &&
      cached.token === token &&
      cached.url === environment.url &&
      cached.username === environment.username
    ) {
      return cached.client;
    }

    const client = new JenkinsClient({
      baseUrl: environment.url,
      username: environment.username,
      token,
      requestTimeoutMs: this.requestTimeoutMs
    });

    this.clientCache.set(cacheKey, {
      client,
      token,
      url: environment.url,
      username: environment.username
    });

    return client;
  }

  invalidateClient(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const cacheKey = `${scope}:${environmentId}`;
    this.clientCache.delete(cacheKey);
  }
}
