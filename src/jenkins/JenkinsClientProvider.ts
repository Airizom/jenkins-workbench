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

    // Only publish onto the entry this client was built from; a newer resolution or an
    // invalidation must not be replaced by a client carrying older credentials.
    if (this.clientCache.get(cacheKey) === entry) {
      this.clientCache.set(cacheKey, {
        ...entry,
        client
      });
    }

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

    const authConfigRevision = this.store.getAuthConfigRevision(
      environment.scope,
      environment.environmentId
    );
    const refreshed = await this.browserSsoAuthenticator.authenticate({
      environmentUrl: environment.url,
      loginUrl: currentAuthConfig.loginUrl,
      currentAuthConfig,
      reason: "reauth"
    });
    if (!refreshed) {
      return undefined;
    }

    // The auth config may have been edited while the browser flow was pending; never
    // overwrite that newer configuration with credentials from this older attempt.
    const saved = await this.store.setAuthConfigIfRevision(
      environment.scope,
      environment.environmentId,
      refreshed,
      authConfigRevision
    );
    return saved ? refreshed : undefined;
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
    for (;;) {
      const authConfigRevision = this.store.getAuthConfigRevision(
        environment.scope,
        environment.environmentId
      );
      const cached = this.getCurrentCacheEntry(cacheKey, environment, authConfigRevision);
      if (cached) {
        return { cacheKey, entry: cached };
      }

      const authMaterial = await this.resolveAuthMaterial(environment);
      // Credentials changed while this read was pending; resolve again rather than
      // publishing material for a revision that is already stale.
      if (
        this.store.getAuthConfigRevision(environment.scope, environment.environmentId) !==
        authConfigRevision
      ) {
        continue;
      }
      const current = this.getCurrentCacheEntry(cacheKey, environment, authConfigRevision);
      if (current) {
        return { cacheKey, entry: current };
      }

      const previous = this.clientCache.get(cacheKey);
      const client =
        previous?.url === environment.url &&
        previous.username === environment.username &&
        previous.client &&
        previous.authMaterial.authSignature === authMaterial.authSignature &&
        previous.authMaterial.token === authMaterial.token
          ? previous.client
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

  private getCurrentCacheEntry(
    cacheKey: string,
    environment: JenkinsEnvironmentRef,
    authConfigRevision: number
  ): JenkinsClientCacheEntry | undefined {
    const cached = this.clientCache.get(cacheKey);
    return cached?.url === environment.url &&
      cached.username === environment.username &&
      cached.authConfigRevision === authConfigRevision
      ? cached
      : undefined;
  }
}
