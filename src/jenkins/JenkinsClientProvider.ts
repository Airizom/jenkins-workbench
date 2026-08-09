import type { BrowserSsoAuthenticator } from "../services/BrowserSsoAuthenticationService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { buildAuthSignature } from "./auth";
import { JenkinsClient } from "./JenkinsClient";
import type { JenkinsEnvironmentRef } from "./JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "./types";

export interface JenkinsClientProviderOptions {
  requestTimeoutMs?: number;
  browserSsoAuthenticator?: BrowserSsoAuthenticator;
}

interface JenkinsAuthMaterial {
  authConfig: JenkinsAuthConfig | undefined;
  authSignature: string;
  token: string | undefined;
}

interface JenkinsClientCacheEntry {
  client?: JenkinsClient;
  authMaterial: JenkinsAuthMaterial;
  authConfigRevision: number;
  url: string;
  username?: string;
}

interface JenkinsClientCacheResolution {
  cacheKey: string;
  entry: JenkinsClientCacheEntry;
}

export class JenkinsClientProvider {
  private readonly clientCache = new Map<string, JenkinsClientCacheEntry>();
  private requestTimeoutMs?: number;
  private readonly browserSsoAuthenticator?: BrowserSsoAuthenticator;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    options?: JenkinsClientProviderOptions
  ) {
    this.requestTimeoutMs = options?.requestTimeoutMs;
    this.browserSsoAuthenticator = options?.browserSsoAuthenticator;
  }

  async getAuthSignature(environment: JenkinsEnvironmentRef): Promise<string> {
    const { entry } = await this.resolveClientCache(environment);
    return entry.authMaterial.authSignature;
  }

  async getClient(environment: JenkinsEnvironmentRef): Promise<JenkinsClient> {
    const { cacheKey, entry } = await this.resolveClientCache(environment);
    if (entry.client) {
      return entry.client;
    }

    const { authConfig, token } = entry.authMaterial;
    const client = new JenkinsClient({
      baseUrl: environment.url,
      username: environment.username,
      token,
      authConfig,
      refreshAuthConfig: (currentAuthConfig) =>
        this.refreshBrowserSsoAuthConfig(environment, currentAuthConfig),
      requestTimeoutMs: this.requestTimeoutMs
    });

    this.clientCache.set(cacheKey, {
      ...entry,
      client
    });

    return client;
  }

  invalidateClient(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const cacheKey = `${scope}:${environmentId}`;
    this.clientCache.delete(cacheKey);
  }

  private async refreshBrowserSsoAuthConfig(
    environment: JenkinsEnvironmentRef,
    currentAuthConfig: JenkinsAuthConfig
  ): Promise<JenkinsAuthConfig | undefined> {
    if (currentAuthConfig?.type !== "sso" || !this.browserSsoAuthenticator) {
      return undefined;
    }

    const refreshed = await this.browserSsoAuthenticator.authenticate({
      environmentUrl: environment.url,
      loginUrl: currentAuthConfig.loginUrl,
      currentAuthConfig,
      reason: "reauth"
    });
    if (!refreshed) {
      return undefined;
    }

    await this.store.setAuthConfig(environment.scope, environment.environmentId, refreshed);
    return refreshed;
  }

  private async resolveAuthMaterial(
    environment: JenkinsEnvironmentRef
  ): Promise<JenkinsAuthMaterial> {
    const authConfig = await this.store.getAuthConfig(environment.scope, environment.environmentId);
    const token = authConfig
      ? undefined
      : await this.store.getToken(environment.scope, environment.environmentId);
    const authSignature = buildAuthSignature(authConfig, {
      username: environment.username,
      token
    });
    return { authConfig, authSignature, token };
  }

  private async resolveClientCache(
    environment: JenkinsEnvironmentRef
  ): Promise<JenkinsClientCacheResolution> {
    const cacheKey = `${environment.scope}:${environment.environmentId}`;
    const authConfigRevision = this.store.getAuthConfigRevision(
      environment.scope,
      environment.environmentId
    );
    const cached = this.clientCache.get(cacheKey);
    const identityMatches =
      cached?.url === environment.url && cached.username === environment.username;

    if (identityMatches && cached.authConfigRevision === authConfigRevision) {
      return { cacheKey, entry: cached };
    }

    const authMaterial = await this.resolveAuthMaterial(environment);
    const client =
      identityMatches &&
      cached.client &&
      cached.authMaterial.authSignature === authMaterial.authSignature &&
      cached.authMaterial.token === authMaterial.token
        ? cached.client
        : undefined;
    const entry: JenkinsClientCacheEntry = {
      client,
      authMaterial,
      authConfigRevision,
      url: environment.url,
      username: environment.username
    };
    this.clientCache.set(cacheKey, entry);
    return { cacheKey, entry };
  }
}
