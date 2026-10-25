import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig, JenkinsClientOptions } from "../src/jenkins/types";
import { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext } from "./helpers/storageMocks";

vi.doMock("../src/jenkins/JenkinsClient", () => ({
  JenkinsClient: class {
    constructor(readonly options: JenkinsClientOptions) {}
  }
}));
const { JenkinsClientProvider } = await import("../src/jenkins/JenkinsClientProvider");

describe("JenkinsClientProvider client caching", () => {
  it("reuses and invalidates auth material consistently across both accessors", async () => {
    let authConfigRevision = 0;
    let token = "first-token";
    let authConfigReads = 0;
    let tokenReads = 0;
    const store = {
      getAllowInsecureTls: () => false,
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
      getAllowInsecureTls: () => false,
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
      getAllowInsecureTls: () => false,
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
  it.each([
    { type: "bearer", token: "edited-token" },
    { type: "sso", loginUrl: "https://jenkins.example.com/other-login" },
    {
      type: "sso",
      loginUrl: "https://jenkins.example.com/login",
      headers: { Cookie: "new-session" }
    },
    undefined
  ] satisfies (JenkinsAuthConfig | undefined)[])(
    "rejects an old client's refresh after authentication is replaced with %j",
    async (editedConfig) => {
      const originalConfig: JenkinsAuthConfig = {
        type: "sso",
        loginUrl: "https://jenkins.example.com/login"
      };
      let authConfigRevision = 0;
      let storedConfig: JenkinsAuthConfig | undefined = originalConfig;
      const save = vi.fn(async (_scope, _id, config: JenkinsAuthConfig) => {
        storedConfig = config;
        return true;
      });
      const store = {
        getAllowInsecureTls: () => false,
        getAuthConfigRevision: () => authConfigRevision,
        getAuthConfig: async () => storedConfig,
        setAuthConfigIfRevision: save
      } as unknown as JenkinsEnvironmentStore;
      const authenticate = vi.fn(async () => ({
        ...originalConfig,
        headers: { Cookie: "stale-session" }
      }));
      const provider = new JenkinsClientProvider(store, {
        browserSsoAuthenticator: { authenticate }
      });
      const environment: JenkinsEnvironmentRef = {
        environmentId: "environment-1",
        scope: "global",
        url: "https://jenkins.example.com/"
      };
      const client = (await provider.getClient(environment)) as unknown as {
        options: JenkinsClientOptions;
      };
      const refresh = client.options.refreshAuthConfig;
      assert.ok(refresh);

      storedConfig = editedConfig;
      authConfigRevision += 1;
      provider.invalidateClient(environment.scope, environment.environmentId);

      assert.equal(await refresh(originalConfig), undefined);
      assert.deepEqual(storedConfig, editedConfig);
      assert.equal(authenticate.mock.calls.length, 0);
      assert.equal(save.mock.calls.length, 0);
    }
  );

  it("rejects a refresh when authentication changes during the store read", async () => {
    const originalConfig: JenkinsAuthConfig = {
      type: "sso",
      loginUrl: "https://jenkins.example.com/login"
    };
    let authConfigRevision = 0;
    const store = {
      getAllowInsecureTls: () => false,
      getAuthConfigRevision: () => authConfigRevision,
      getAuthConfig: async () => {
        authConfigRevision += 1;
        return originalConfig;
      },
      setAuthConfigIfRevision: vi.fn()
    } as unknown as JenkinsEnvironmentStore;
    const authenticate = vi.fn(async () => originalConfig);
    const provider = new JenkinsClientProvider(store, {
      browserSsoAuthenticator: { authenticate }
    });
    const refresh = (
      provider as unknown as {
        refreshBrowserSsoAuthConfig(
          environment: JenkinsEnvironmentRef,
          currentAuthConfig: JenkinsAuthConfig
        ): Promise<JenkinsAuthConfig | undefined>;
      }
    ).refreshBrowserSsoAuthConfig.bind(provider);

    assert.equal(
      await refresh(
        {
          environmentId: "environment-1",
          scope: "global",
          url: "https://jenkins.example.com/"
        },
        originalConfig
      ),
      undefined
    );
    assert.equal(authenticate.mock.calls.length, 0);
    assert.equal(vi.mocked(store.setAuthConfigIfRevision).mock.calls.length, 0);
  });

  it("does not overwrite an auth config saved while SSO reauth was pending", async () => {
    const originalConfig: JenkinsAuthConfig = {
      type: "sso",
      loginUrl: "https://jenkins.example.com/login"
    };
    const editedConfig: JenkinsAuthConfig = { type: "bearer", token: "edited-token" };
    let authConfigRevision = 0;
    let storedConfig: JenkinsAuthConfig | undefined = originalConfig;
    const store = {
      getAllowInsecureTls: () => false,
      getAuthConfigRevision: () => authConfigRevision,
      getAuthConfig: async () => storedConfig,
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

describe("JenkinsClientProvider TLS policy", () => {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "tls-env",
    scope: "workspace",
    url: "https://jenkins.example.com/"
  };

  function options(client: unknown): JenkinsClientOptions {
    return (client as { options: JenkinsClientOptions }).options;
  }

  it("uses current stored policy instead of stale references and recreates clients on changes", async () => {
    const store = new JenkinsEnvironmentStore(createExtensionContext());
    await store.addEnvironment("workspace", { id: "tls-env", url: environment.url });
    const provider = new JenkinsClientProvider(store);
    const staleInsecure = { ...environment, allowInsecureTls: true };
    const secureClient = await provider.getClient(staleInsecure);
    assert.equal(options(secureClient).allowInsecureTls, false);

    await store.updateEnvironment("workspace", "tls-env", { allowInsecureTls: true });
    const insecureClient = await provider.getClient(environment);
    assert.notStrictEqual(insecureClient, secureClient);
    assert.equal(options(insecureClient).allowInsecureTls, true);
    assert.strictEqual(await provider.getClient(environment), insecureClient);

    await store.updateEnvironment("workspace", "tls-env", { allowInsecureTls: false });
    const restoredClient = await provider.getClient(staleInsecure);
    assert.notStrictEqual(restoredClient, insecureClient);
    assert.equal(options(restoredClient).allowInsecureTls, false);
  });

  it("isolates environments and scopes, and does not grant exceptions to an old origin", async () => {
    const store = new JenkinsEnvironmentStore(createExtensionContext());
    await store.addEnvironment("workspace", {
      id: "tls-env",
      url: environment.url,
      allowInsecureTls: true
    });
    await store.addEnvironment("global", { id: "tls-env", url: environment.url });
    await store.addEnvironment("workspace", { id: "other-env", url: environment.url });
    const provider = new JenkinsClientProvider(store);
    assert.equal(options(await provider.getClient(environment)).allowInsecureTls, true);
    assert.equal(
      options(await provider.getClient({ ...environment, scope: "global" })).allowInsecureTls,
      false
    );
    assert.equal(
      options(await provider.getClient({ ...environment, environmentId: "other-env" }))
        .allowInsecureTls,
      false
    );
    assert.equal(
      options(await provider.getClient({ ...environment, environmentId: "missing" }))
        .allowInsecureTls,
      false
    );

    const nextUrl = "https://new-jenkins.example.com/";
    await store.updateEnvironment("workspace", "tls-env", { url: nextUrl });
    await store.updateEnvironment("workspace", "tls-env", { allowInsecureTls: true });
    assert.equal(options(await provider.getClient(environment)).allowInsecureTls, false);
    assert.equal(
      options(await provider.getClient({ ...environment, url: nextUrl })).allowInsecureTls,
      true
    );
  });

  it.each([true, false])(
    "rechecks a policy changed to %s during a pending secret read",
    async (nextPolicy) => {
      const store = new JenkinsEnvironmentStore(createExtensionContext());
      await store.addEnvironment("workspace", {
        id: "tls-env",
        url: environment.url,
        allowInsecureTls: !nextPolicy
      });
      const pending: { release?: () => void } = {};
      const originalGetAuthConfig = store.getAuthConfig.bind(store);
      let reads = 0;
      vi.spyOn(store, "getAuthConfig").mockImplementation(async (scope, id) => {
        if (reads++ === 0) {
          await new Promise<void>((resolve) => {
            pending.release = resolve;
          });
        }
        return originalGetAuthConfig(scope, id);
      });
      const provider = new JenkinsClientProvider(store);
      const clientPromise = provider.getClient(environment);
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(pending.release);
      await store.updateEnvironment("workspace", "tls-env", { allowInsecureTls: nextPolicy });
      pending.release();
      const client = await clientPromise;
      assert.equal(options(client).allowInsecureTls, nextPolicy);
      assert.strictEqual(await provider.getClient(environment), client);
    }
  );

  it("rechecks policy after a cached resolution yields back to its caller", async () => {
    const store = new JenkinsEnvironmentStore(createExtensionContext());
    await store.addEnvironment("workspace", {
      id: "tls-env",
      url: environment.url,
      allowInsecureTls: true
    });
    const provider = new JenkinsClientProvider(store);
    const insecureClient = await provider.getClient(environment);
    let currentPolicy = true;
    let reads = 0;
    vi.spyOn(store, "getAllowInsecureTls").mockImplementation(() => {
      // The first synchronous cache lookup observes the old policy. The next lookup,
      // when getClient resumes after its await, observes the newly committed policy.
      if (reads++ > 0) currentPolicy = false;
      return currentPolicy;
    });
    const secureClient = await provider.getClient(environment);
    assert.notStrictEqual(secureClient, insecureClient);
    assert.equal(options(secureClient).allowInsecureTls, false);
  });
});
