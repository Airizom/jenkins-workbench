import { describe, expect, it, vi } from "vitest";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../src/environments/sharing/DeclaredEnvironmentSource";
import {
  createDeclaredEnvironmentView,
  DeclaredEnvironmentRegistry
} from "../src/environments/sharing/DeclaredEnvironmentRegistry";
import { DeclaredEnvironmentStateStore } from "../src/environments/sharing/DeclaredEnvironmentStateStore";
import type { EnvironmentAuthHint } from "../src/storage/EnvironmentAuthHint";
import { EnvironmentSignInRequiredError } from "../src/jenkins/errors";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsClientOptions } from "../src/jenkins/types";
import {
  type EnvironmentScope,
  JenkinsEnvironmentStore
} from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

vi.doMock("../src/jenkins/JenkinsClient", () => ({
  JenkinsClient: class {
    constructor(readonly options: JenkinsClientOptions) {}
  }
}));
const { JenkinsClientProvider } = await import("../src/jenkins/JenkinsClientProvider");

function declared(
  authHint?: EnvironmentAuthHint,
  url = "https://ci.example/"
): DeclaredEnvironment {
  return {
    scope: "workspace",
    slug: "ci",
    id: "settings:ci",
    url,
    name: "CI",
    ...(authHint ? { authHint } : {}),
    origin: { level: "workspace" }
  };
}

function setup(declarations: DeclaredEnvironment[]) {
  let current = declarations;
  const source = {
    getDeclared: (scope: EnvironmentScope) => current.filter((entry) => entry.scope === scope),
    getDeclaration: (scope: EnvironmentScope, id: string) =>
      current.find((entry) => entry.scope === scope && entry.id === id)
  } as unknown as DeclaredEnvironmentSource;
  const secrets = createFakeSecretStorage();
  const context = createExtensionContext({ secrets });
  const state = new DeclaredEnvironmentStateStore(context);
  const store = new JenkinsEnvironmentStore(
    context,
    createDeclaredEnvironmentView({ source, state })
  );
  const provider = new JenkinsClientProvider(store);
  const registry = new DeclaredEnvironmentRegistry({
    source,
    state,
    environmentStore: store,
    clientProvider: provider
  });
  return {
    store,
    registry,
    state,
    provider,
    secrets,
    setDeclarations(next: DeclaredEnvironment[]) {
      current = next;
    }
  };
}

const ref: JenkinsEnvironmentRef = {
  environmentId: "settings:ci",
  scope: "workspace",
  url: "https://ci.example/",
  name: "CI"
};

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

describe("JenkinsClientProvider sign-in gating", () => {
  it("refuses an unconfirmed shared server until its origin is acknowledged", async () => {
    const { provider, registry } = setup([declared({ type: "none" })]);

    const error = await captureError(provider.getClient(ref));
    expect(error).toBeInstanceOf(EnvironmentSignInRequiredError);
    expect(error).toMatchObject({
      scope: "workspace",
      environmentId: "settings:ci",
      requirement: "confirm-origin"
    });
    await expect(provider.getAuthSignature(ref)).rejects.toBeInstanceOf(
      EnvironmentSignInRequiredError
    );
    // Diagnostics may run without credentials, never against an unconfirmed server.
    await expect(provider.createEnvironmentDiagnosticsClient(ref)).rejects.toBeInstanceOf(
      EnvironmentSignInRequiredError
    );

    await registry.acknowledgeOrigin("workspace", "settings:ci");
    const client = (await provider.getClient(ref)) as unknown as { options: JenkinsClientOptions };
    expect(client.options.baseUrl).toBe("https://ci.example/");
  });

  it.each([
    ["basic", { type: "basic" }],
    ["bearer", { type: "bearer" }],
    ["sso", { type: "sso", loginUrl: "https://sso.example/login" }],
    ["missing", undefined]
  ] as const)(
    "requires credentials for a confirmed shared server with a %s hint",
    async (_label, hint) => {
      const { store, provider, registry } = setup([
        declared(hint as EnvironmentAuthHint | undefined)
      ]);
      await registry.acknowledgeOrigin("workspace", "settings:ci");

      await expect(provider.getClient(ref)).rejects.toMatchObject({
        requirement: "credentials"
      });
      const diagnosticsClient = await provider.createEnvironmentDiagnosticsClient(ref);
      expect(diagnosticsClient).toBeDefined();
      // The credential-less diagnostics resolution must not unlock ordinary clients.
      await expect(provider.getClient(ref)).rejects.toBeInstanceOf(EnvironmentSignInRequiredError);

      await store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "t" });
      const client = (await provider.getClient(ref)) as unknown as {
        options: JenkinsClientOptions;
      };
      expect(client.options.authConfig).toEqual({ type: "bearer", token: "t" });
    }
  );

  it("requires credentials for a stored environment whose hint has no local secret", async () => {
    const { store, provider } = setup([]);
    await store.addEnvironment("global", {
      id: "env-1",
      url: "https://jenkins.example/",
      authHint: { type: "basic" }
    });
    const storedRef: JenkinsEnvironmentRef = {
      environmentId: "env-1",
      scope: "global",
      url: "https://jenkins.example/"
    };

    const error = await captureError(provider.getClient(storedRef));
    expect(error).toMatchObject({ requirement: "credentials" });
    expect((error as Error).message).toContain("jenkins.example");

    await store.setToken("global", "env-1", "legacy-token");
    // A legacy token counts as credentials; blocked lookups are never cached.
    await expect(provider.getClient(storedRef)).resolves.toBeDefined();
  });

  it("builds clients normally for legacy stored environments without a hint", async () => {
    const { store, provider } = setup([]);
    await store.addEnvironment("global", { id: "env-1", url: "https://jenkins.example/" });

    await expect(
      provider.getClient({
        environmentId: "env-1",
        scope: "global",
        url: "https://jenkins.example/"
      })
    ).resolves.toBeDefined();
  });

  it("asks again after a shared server moves to a new origin", async () => {
    const harness = setup([declared({ type: "none" })]);
    await harness.registry.acknowledgeOrigin("workspace", "settings:ci");
    await harness.provider.getClient(ref);

    harness.setDeclarations([declared({ type: "none" }, "https://moved.example/")]);
    harness.provider.invalidateClient("workspace", "settings:ci");

    await expect(
      harness.provider.getClient({ ...ref, url: "https://moved.example/" })
    ).rejects.toMatchObject({ requirement: "confirm-origin" });
  });
});
