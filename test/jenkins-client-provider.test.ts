import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../src/jenkins/types";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";

describe("JenkinsClientProvider client caching", () => {
  it("reuses and invalidates auth material consistently across both accessors", async () => {
    let authConfigRevision = 0;
    let token = "first-token";
    let authConfigReads = 0;
    let tokenReads = 0;
    const store = {
      getAuthConfigRevision: () => authConfigRevision,
      getAuthConfig: async () => {
        authConfigReads += 1;
        return undefined;
      },
      getToken: async () => {
        tokenReads += 1;
        return token;
      }
    } as unknown as JenkinsEnvironmentStore;
    const provider = new JenkinsClientProvider(store);
    const environment: JenkinsEnvironmentRef = {
      environmentId: "environment-1",
      scope: "global",
      url: "https://jenkins.example.com/",
      username: "developer"
    };

    const firstSignature = await provider.getAuthSignature(environment);
    const firstClient = await provider.getClient(environment);
    const cachedClient = await provider.getClient(environment);
    const cachedSignature = await provider.getAuthSignature(environment);

    assert.strictEqual(cachedClient, firstClient);
    assert.equal(cachedSignature, firstSignature);
    assert.equal(authConfigReads, 1);
    assert.equal(tokenReads, 1);

    authConfigRevision += 1;
    token = "second-token";
    const refreshedClient = await provider.getClient(environment);
    const refreshedSignature = await provider.getAuthSignature(environment);

    assert.notStrictEqual(refreshedClient, firstClient);
    assert.notEqual(refreshedSignature, firstSignature);
    assert.equal(authConfigReads, 2);
    assert.equal(tokenReads, 2);

    const movedEnvironment = {
      ...environment,
      url: "https://moved-jenkins.example.com/"
    };
    const movedSignature = await provider.getAuthSignature(movedEnvironment);
    const movedClient = await provider.getClient(movedEnvironment);

    assert.equal(movedSignature, refreshedSignature);
    assert.notStrictEqual(movedClient, refreshedClient);
    assert.equal(authConfigReads, 3);
    assert.equal(tokenReads, 3);

    const renamedEnvironment = {
      ...movedEnvironment,
      username: "another-developer"
    };
    const renamedClient = await provider.getClient(renamedEnvironment);
    const renamedSignature = await provider.getAuthSignature(renamedEnvironment);

    assert.notStrictEqual(renamedClient, movedClient);
    assert.notEqual(renamedSignature, movedSignature);
    assert.equal(authConfigReads, 4);
    assert.equal(tokenReads, 4);
  });

  it("shares one secret read between concurrent cold-cache callers", async () => {
    let authConfigReads = 0;
    let releaseRead: (() => void) | undefined;
    const store = {
      getAuthConfigRevision: () => 0,
      getAuthConfig: async () => {
        authConfigReads += 1;
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        return { type: "bearer", token: "secret" } satisfies JenkinsAuthConfig;
      },
      getToken: async () => undefined
    } as unknown as JenkinsEnvironmentStore;
    const provider = new JenkinsClientProvider(store);
    const environment: JenkinsEnvironmentRef = {
      environmentId: "environment-1",
      scope: "global",
      url: "https://jenkins.example.com/"
    };

    const pending = Promise.all([
      provider.getClient(environment),
      provider.getAuthSignature(environment),
      provider.getClient(environment)
    ]);
    await Promise.resolve();
    releaseRead?.();
    const [firstClient, , secondClient] = await pending;

    assert.equal(authConfigReads, 1);
    assert.ok(firstClient);
    assert.ok(secondClient);
  });

  it("does not publish a stale resolution after credentials change mid-read", async () => {
    let authConfigRevision = 0;
    let token = "old-token";
    const firstRead: { release?: () => void } = {};
    let tokenReads = 0;
    const store = {
      getAuthConfigRevision: () => authConfigRevision,
      getAuthConfig: async () => undefined,
      getToken: async () => {
        tokenReads += 1;
        const snapshot = token;
        if (tokenReads === 1) {
          await new Promise<void>((resolve) => {
            firstRead.release = resolve;
          });
        }
        return snapshot;
      }
    } as unknown as JenkinsEnvironmentStore;
    const provider = new JenkinsClientProvider(store);
    const environment: JenkinsEnvironmentRef = {
      environmentId: "environment-1",
      scope: "global",
      url: "https://jenkins.example.com/",
      username: "developer"
    };

    const staleClientPromise = provider.getClient(environment);
    await new Promise((resolve) => setImmediate(resolve));
    const releaseFirstRead = firstRead.release;
    assert.ok(releaseFirstRead);

    authConfigRevision += 1;
    token = "new-token";
    const latestClient = await provider.getClient(environment);
    const latestSignature = await provider.getAuthSignature(environment);

    releaseFirstRead();
    const resolvedClient = await staleClientPromise;

    assert.strictEqual(resolvedClient, latestClient);
    assert.strictEqual(await provider.getClient(environment), latestClient);
    assert.equal(await provider.getAuthSignature(environment), latestSignature);
  });
});

describe("JenkinsClientProvider SSO refresh", () => {
  it("does not overwrite an auth config saved while SSO reauth was pending", async () => {
    const originalConfig: JenkinsAuthConfig = {
      type: "sso",
      loginUrl: "https://jenkins.example.com/login"
    };
    const editedConfig: JenkinsAuthConfig = { type: "bearer", token: "edited-token" };
    let authConfigRevision = 0;
    let storedConfig: JenkinsAuthConfig | undefined = originalConfig;
    const store = {
      getAuthConfigRevision: () => authConfigRevision,
      setAuthConfigIfRevision: async (
        _scope: string,
        _id: string,
        authConfig: JenkinsAuthConfig,
        expectedRevision: number
      ) => {
        if (authConfigRevision !== expectedRevision) {
          return false;
        }
        authConfigRevision += 1;
        storedConfig = authConfig;
        return true;
      }
    } as unknown as JenkinsEnvironmentStore;
    const pendingAuth: { resolve?: (config: JenkinsAuthConfig) => void } = {};
    const provider = new JenkinsClientProvider(store, {
      browserSsoAuthenticator: {
        authenticate: () =>
          new Promise<JenkinsAuthConfig>((resolve) => {
            pendingAuth.resolve = resolve;
          })
      }
    });
    const environment: JenkinsEnvironmentRef = {
      environmentId: "environment-1",
      scope: "global",
      url: "https://jenkins.example.com/"
    };
    const refresh = (
      provider as unknown as {
        refreshBrowserSsoAuthConfig(
          environment: JenkinsEnvironmentRef,
          currentAuthConfig: JenkinsAuthConfig
        ): Promise<JenkinsAuthConfig | undefined>;
      }
    ).refreshBrowserSsoAuthConfig.bind(provider);

    const refreshPromise = refresh(environment, originalConfig);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pendingAuth.resolve);

    authConfigRevision += 1;
    storedConfig = editedConfig;
    pendingAuth.resolve({ ...originalConfig, headers: { Cookie: "stale-session" } });

    assert.equal(await refreshPromise, undefined);
    assert.deepEqual(storedConfig, editedConfig);
  });
});
