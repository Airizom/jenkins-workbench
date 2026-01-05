import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { buildAuthSignature } from "./auth";
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
      authSignature?: string;
      authConfigRevision?: number;
      token?: string;
      url: string;
      username?: string;
    }
  >();
  private readonly authSignatureCache = new Map<
    string,
    {
      authSignature: string;
      authConfigRevision: number;
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
    this.authSignatureCache.clear();
  }

  async getAuthSignature(environment: JenkinsEnvironmentRef): Promise<string> {
    const cacheKey = `${environment.scope}:${environment.environmentId}`;
    const authConfigRevision = this.store.getAuthConfigRevision(
      environment.scope,
      environment.environmentId
    );
    const cachedClient = this.clientCache.get(cacheKey);
    if (
      cachedClient?.authSignature &&
      cachedClient.authConfigRevision === authConfigRevision &&
      cachedClient.url === environment.url &&
      cachedClient.username === environment.username
    ) {
      return cachedClient.authSignature;
    }

    const cachedSignature = this.authSignatureCache.get(cacheKey);
    if (
      cachedSignature?.authSignature &&
      cachedSignature.authConfigRevision === authConfigRevision &&
      cachedSignature.url === environment.url &&
      cachedSignature.username === environment.username
    ) {
      return cachedSignature.authSignature;
    }

    const authConfig = await this.store.getAuthConfig(environment.scope, environment.environmentId);
    const token = authConfig
      ? undefined
      : await this.store.getToken(environment.scope, environment.environmentId);
    const authSignature = buildAuthSignature(authConfig, {
      username: environment.username,
      token
    });
    this.authSignatureCache.set(cacheKey, {
      authSignature,
      authConfigRevision,
      url: environment.url,
      username: environment.username
    });
    return authSignature;
  }

  async getClient(environment: JenkinsEnvironmentRef): Promise<JenkinsClient> {
    const authConfigRevision = this.store.getAuthConfigRevision(
      environment.scope,
      environment.environmentId
    );
    const authConfig = await this.store.getAuthConfig(environment.scope, environment.environmentId);
    const token = authConfig
      ? undefined
      : await this.store.getToken(environment.scope, environment.environmentId);
    const authSignature = buildAuthSignature(authConfig, {
      username: environment.username,
      token
    });

    const cacheKey = `${environment.scope}:${environment.environmentId}`;
    const cached = this.clientCache.get(cacheKey);

    if (
      cached &&
      cached.authSignature === authSignature &&
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
      authConfig,
      requestTimeoutMs: this.requestTimeoutMs
    });

    this.clientCache.set(cacheKey, {
      client,
      authSignature,
      authConfigRevision,
      token,
      url: environment.url,
      username: environment.username
    });
    this.authSignatureCache.set(cacheKey, {
      authSignature,
      authConfigRevision,
      url: environment.url,
      username: environment.username
    });

    return client;
  }

  invalidateClient(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const cacheKey = `${scope}:${environmentId}`;
    this.clientCache.delete(cacheKey);
    this.authSignatureCache.delete(cacheKey);
  }
}
