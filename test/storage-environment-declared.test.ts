import { describe, expect, it, vi } from "vitest";
import {
  createDeclaredEnvironmentView,
  DeclaredEnvironmentRegistry
} from "../src/environments/sharing/DeclaredEnvironmentRegistry";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../src/environments/sharing/DeclaredEnvironmentSource";
import { DeclaredEnvironmentStateStore } from "../src/environments/sharing/DeclaredEnvironmentStateStore";
import { findSuppressingStored } from "../src/storage/DeclaredEnvironmentView";
import type { EnvironmentAuthHint } from "../src/storage/EnvironmentAuthHint";
import {
  type EnvironmentScope,
  JenkinsEnvironmentStore,
  type JenkinsEnvironmentStoreChange
} from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";

function declared(
  slug: string,
  url: string,
  options: {
    scope?: EnvironmentScope;
    name?: string;
    allowInsecureTls?: boolean;
    authHint?: EnvironmentAuthHint;
  } = {}
): DeclaredEnvironment {
  const scope = options.scope ?? "workspace";
  return {
    scope,
    slug,
    id: `settings:${slug}`,
    url,
    ...(options.name ? { name: options.name } : {}),
    ...(options.allowInsecureTls ? { allowInsecureTls: true } : {}),
    ...(options.authHint ? { authHint: options.authHint } : {}),
    origin: { level: scope === "global" ? "user" : "workspace" }
  };
}

function createFakeSource(initial: DeclaredEnvironment[] = []) {
  let declarations = initial;
  const source = {
    getDeclared: (scope: EnvironmentScope) => declarations.filter((entry) => entry.scope === scope),
    getDeclaration: (scope: EnvironmentScope, id: string) =>
      declarations.find((entry) => entry.scope === scope && entry.id === id),
    getProblems: () => [],
    onDidChange: () => ({ dispose: () => undefined }),
    dispose: () => undefined
  };
  return {
    source: source as unknown as DeclaredEnvironmentSource,
    set(next: DeclaredEnvironment[]) {
      declarations = next;
    }
  };
}

function createDeclared(
  context: ReturnType<typeof createExtensionContext>,
  source: DeclaredEnvironmentSource
) {
  const state = new DeclaredEnvironmentStateStore(context);
  const store = new JenkinsEnvironmentStore(
    context,
    createDeclaredEnvironmentView({ source, state })
  );
  const invalidateClient = vi.fn();
  const registry = new DeclaredEnvironmentRegistry({
    source,
    state,
    environmentStore: store,
    clientProvider: { invalidateClient }
  });
  return { state, store, registry, invalidateClient };
}

function setup(declarations: DeclaredEnvironment[] = []) {
  const secrets = createFakeSecretStorage();
  const context = createExtensionContext({ secrets });
  const fake = createFakeSource(declarations);
  const { state, store, registry, invalidateClient } = createDeclared(context, fake.source);
  const changes: JenkinsEnvironmentStoreChange[] = [];
  store.onDidChange((change) => changes.push(change));
  return { context, secrets, fake, state, store, registry, invalidateClient, changes };
}

async function findSuppressing(
  { fake, state, store }: ReturnType<typeof setup>,
  declaration: DeclaredEnvironment
) {
  return findSuppressingStored(
    createDeclaredEnvironmentView({ source: fake.source, state }),
    {
      workspace: await store.getStoredEnvironments("workspace"),
      global: await store.getStoredEnvironments("global")
    },
    declaration.scope,
    declaration
  );
}

describe("JenkinsEnvironmentStore with settings declarations", () => {
  it("merges declared records after stored ones without persisting them", async () => {
    const { context, store, state, registry } = setup([
      declared("ci", "https://ci.example/", {
        name: "CI",
        authHint: { type: "sso", loginUrl: "https://sso.example/" }
      }),
      declared("personal", "https://personal.example/", {
        scope: "global",
        allowInsecureTls: true
      })
    ]);
    await store.addEnvironment("workspace", { id: "uuid-1", url: "https://manual.example/" });
    await state.update("workspace", "settings:ci", { previousUrls: ["https://old.example/"] });

    expect(await store.getEnvironments("workspace")).toEqual([
      { id: "uuid-1", url: "https://manual.example/" },
      {
        id: "settings:ci",
        url: "https://ci.example/",
        name: "CI",
        authHint: { type: "sso", loginUrl: "https://sso.example/" },
        previousUrls: ["https://old.example/"],
        source: "settings"
      }
    ]);
    expect(await store.getEnvironments("global")).toEqual([
      {
        id: "settings:personal",
        url: "https://personal.example/",
        allowInsecureTls: true,
        source: "settings"
      }
    ]);
    expect(await store.getStoredEnvironments("workspace")).toEqual([
      { id: "uuid-1", url: "https://manual.example/" }
    ]);
    expect(context.globalState.get(ENVIRONMENTS_KEY)).toBeUndefined();
    expect((await store.listEnvironmentsWithScope()).map(({ scope, id }) => [scope, id])).toEqual([
      ["workspace", "uuid-1"],
      ["workspace", "settings:ci"],
      ["global", "settings:personal"]
    ]);
    expect(store.isDeclared("settings:ci")).toBe(true);
    expect(store.isDeclared("uuid-1")).toBe(false);
    expect(registry.getDeclaration("workspace", "settings:ci")?.slug).toBe("ci");
  });

  it("leaves records unchanged when no declarations are wired", async () => {
    const context = createExtensionContext();
    const store = new JenkinsEnvironmentStore(context);
    await store.addEnvironment("global", { id: "uuid-1", url: "https://a.example/" });
    expect(await store.getEnvironments("global")).toEqual([
      { id: "uuid-1", url: "https://a.example/" }
    ]);
    expect(await store.getSignInRequirement("global", "uuid-1")).toBe("none");
    expect(await store.removeEnvironment("global", "settings:ci")).toBe(false);
  });

  it("omits hidden declarations", async () => {
    const { store, state } = setup([declared("ci", "https://ci.example/")]);
    await state.setHidden("workspace", "settings:ci", true);
    expect(await store.getEnvironments("workspace")).toEqual([]);
  });

  it("suppresses a declaration while a same-URL stored environment is unresolved", async () => {
    const ci = declared("ci", "https://ci.example/jenkins/");
    const harness = setup([ci]);
    const { store, state } = harness;
    await store.addEnvironment("global", {
      id: "uuid-1",
      url: "https://user:secret@CI.example/jenkins"
    });

    expect((await store.getEnvironments("workspace")).map((entry) => entry.id)).toEqual([]);
    expect(await findSuppressing(harness, ci)).toEqual([
      { id: "uuid-1", url: "https://user:secret@CI.example/jenkins", scope: "global" }
    ]);

    await state.update("workspace", "settings:ci", { adoptDeclined: true });
    expect((await store.getEnvironments("workspace")).map((entry) => entry.id)).toEqual([
      "settings:ci"
    ]);
    expect(await findSuppressing(harness, ci)).toEqual([]);
  });

  it("hides stored environments listed in hiddenStoredIds and stops them suppressing", async () => {
    const ci = declared("ci", "https://ci.example/");
    const harness = setup([ci]);
    const { store, state } = harness;
    await store.addEnvironment("global", { id: "uuid-1", url: "https://ci.example/" });
    await store.addEnvironment("global", { id: "uuid-2", url: "https://other.example/" });

    await state.hideStored("global", "uuid-1");

    expect((await store.getEnvironments("global")).map((entry) => entry.id)).toEqual(["uuid-2"]);
    expect((await store.getEnvironments("workspace")).map((entry) => entry.id)).toEqual([
      "settings:ci"
    ]);
    expect(await findSuppressing(harness, ci)).toEqual([]);
    // The hidden record stays persisted and survives later mutations.
    await store.addEnvironment("global", { id: "uuid-3", url: "https://third.example/" });
    expect((await store.getStoredEnvironments("global")).map((entry) => entry.id)).toEqual([
      "uuid-1",
      "uuid-2",
      "uuid-3"
    ]);
  });

  it("never persists declared records through saveEnvironments, add, update, or remove", async () => {
    const { context, store } = setup([declared("ci", "https://ci.example/")]);
    await store.addEnvironment("workspace", { id: "uuid-1", url: "https://a.example/" });

    await store.saveEnvironments("workspace", await store.getEnvironments("workspace"));
    await store.updateEnvironment("workspace", "uuid-1", { name: "A" });
    await store.addEnvironment("workspace", { id: "uuid-2", url: "https://b.example/" });
    await store.removeEnvironment("workspace", "uuid-2");

    expect(context.workspaceState.get(ENVIRONMENTS_KEY)).toEqual([
      { id: "uuid-1", url: "https://a.example/", name: "A" }
    ]);
  });

  it("rejects edits to declared records but accepts empty patches", async () => {
    const { store, changes } = setup([declared("ci", "https://ci.example/")]);

    for (const patch of [
      { name: "Renamed" },
      { url: "https://other.example/" },
      { allowInsecureTls: true },
      { username: null }
    ]) {
      expect(await store.updateEnvironment("workspace", "settings:ci", patch)).toBeUndefined();
    }
    const noop = await store.updateEnvironment("workspace", "settings:ci", {});
    expect(noop?.next).toEqual({
      id: "settings:ci",
      url: "https://ci.example/",
      source: "settings"
    });
    expect(
      await store.updateEnvironment(
        "workspace",
        "settings:ci",
        {},
        { expectedTlsOrigin: "https://other.example" }
      )
    ).toBeUndefined();
    expect(await store.updateEnvironment("workspace", "settings:missing", {})).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("hides a removed declared environment and deletes its secrets", async () => {
    const { store, state, secrets, changes, registry } = setup([
      declared("ci", "https://ci.example/")
    ]);
    await store.setToken("workspace", "settings:ci", "legacy");
    await store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "t" });
    changes.length = 0;

    expect(await registry.hideDeclaredEnvironment("workspace", "settings:ci")).toBe(true);

    expect(state.get("workspace", "settings:ci").hidden).toBe(true);
    expect(await store.getEnvironments("workspace")).toEqual([]);
    expect([...secrets.values.keys()]).toEqual([]);
    expect(changes).toEqual([
      { kind: "environment-removed", scope: "workspace", environmentId: "settings:ci" },
      { kind: "auth-config-deleted", scope: "workspace", environmentId: "settings:ci" }
    ]);
    expect(await registry.hideDeclaredEnvironment("workspace", "settings:missing")).toBe(false);
  });

  it("reads TLS policy from user-level declarations", () => {
    const { store } = setup([
      declared("personal", "https://personal.example/", {
        scope: "global",
        allowInsecureTls: true
      }),
      declared("plain", "https://plain.example/", { scope: "global" })
    ]);
    expect(
      store.getAllowInsecureTls("global", "settings:personal", "https://personal.example/job/a/")
    ).toBe(true);
    expect(store.getAllowInsecureTls("global", "settings:personal", "https://other.example/")).toBe(
      false
    );
    expect(
      store.getAllowInsecureTls("workspace", "settings:personal", "https://personal.example/")
    ).toBe(false);
    expect(store.getAllowInsecureTls("global", "settings:plain", "https://plain.example/")).toBe(
      false
    );
  });

  it("fires bulk-update when declarations change", () => {
    const { changes, registry } = setup();
    registry.notifyDeclaredEnvironmentsChanged();
    expect(changes).toEqual([{ kind: "bulk-update" }]);
  });
});

describe("JenkinsEnvironmentStore.getSignInRequirement", () => {
  it("asks to confirm a declared origin first, then for credentials", async () => {
    const { store, state, registry } = setup([
      declared("ci", "https://ci.example/jenkins/", { authHint: { type: "basic" } })
    ]);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");

    await state.acknowledgeOrigin("workspace", "settings:ci", "https://old.example");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");

    await registry.acknowledgeOrigin("workspace", "settings:ci");
    expect(state.get("workspace", "settings:ci").acknowledgedOrigin).toBe("https://ci.example");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");

    await store.setAuthConfig("workspace", "settings:ci", {
      type: "basic",
      username: "u",
      token: "t"
    });
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("accepts a legacy token for declared environments", async () => {
    const { store, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: { type: "bearer" } })
    ]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    await store.setToken("workspace", "settings:ci", "token");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("needs only origin confirmation for declared auth none", async () => {
    const { store, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: { type: "none" } })
    ]);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("requires credentials for declared environments without a hint", async () => {
    const { store, registry } = setup([declared("ci", "https://ci.example/")]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");
  });

  it("asks again after a declared URL moves to another origin", async () => {
    const { store, fake, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: { type: "none" } })
    ]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    fake.set([declared("ci", "https://ci2.example/", { authHint: { type: "none" } })]);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");
  });

  it("gates stored environments only when they carry an auth hint", async () => {
    const { store } = setup();
    await store.addEnvironment("global", { id: "legacy", url: "https://a.example/" });
    await store.addEnvironment("global", {
      id: "hinted",
      url: "https://b.example/",
      authHint: { type: "sso", loginUrl: "https://b.example/login" }
    });
    await store.addEnvironment("global", {
      id: "anonymous",
      url: "https://c.example/",
      authHint: { type: "none" }
    });

    expect(await store.getSignInRequirement("global", "legacy")).toBe("none");
    expect(await store.getSignInRequirement("global", "anonymous")).toBe("none");
    expect(await store.getSignInRequirement("global", "hinted")).toBe("credentials");
    expect(await store.getSignInRequirement("global", "missing")).toBe("none");

    await store.setAuthConfig("global", "hinted", {
      type: "sso",
      loginUrl: "https://b.example/login",
      headers: { Cookie: "a=b" }
    });
    expect(await store.getSignInRequirement("global", "hinted")).toBe("none");
  });

  it("ignores acknowledgeOrigin for unknown declarations", async () => {
    const { state, registry } = setup();
    await registry.acknowledgeOrigin("workspace", "settings:missing");
    expect(state.get("workspace", "settings:missing")).toEqual({});
  });

  it("forgets the confirmed server when a declared environment is hidden", async () => {
    const { store, state, registry } = setup([declared("ci", "https://ci.example/")]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");

    await registry.hideDeclaredEnvironment("workspace", "settings:ci");
    await registry.unhideEnvironment("workspace", "settings:ci");

    expect(state.get("workspace", "settings:ci")).toEqual({});
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");
  });

  it("uses known credentials instead of reading secrets again", async () => {
    const { store, secrets, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: { type: "basic" } })
    ]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    let reads = 0;
    const get = secrets.get.bind(secrets);
    secrets.get = async (key: string) => {
      reads += 1;
      return get(key);
    };

    expect(
      await store.getSignInRequirement("workspace", "settings:ci", { hasCredentials: true })
    ).toBe("none");
    expect(
      await store.getSignInRequirement("workspace", "settings:ci", { hasCredentials: false })
    ).toBe("credentials");
    expect(reads).toBe(0);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe("https://ci.example");
    expect(registry.getAcknowledgedOrigin("workspace", "uuid-1")).toBeUndefined();
  });

  it("lists and restores hidden declared and linked stored environments", async () => {
    const { store, state, changes, registry } = setup([
      declared("ci", "https://ci.example/", { name: "CI" }),
      declared("gone", "https://gone.example/")
    ]);
    await store.addEnvironment("global", { id: "uuid-1", url: "https://manual.example/" });
    await registry.hideDeclaredEnvironment("workspace", "settings:ci");
    await state.setHidden("workspace", "settings:unknown", true);
    await state.hideStored("global", "uuid-1");
    changes.length = 0;

    expect(await registry.listHiddenEnvironments()).toEqual([
      {
        id: "settings:ci",
        url: "https://ci.example/",
        name: "CI",
        source: "settings",
        scope: "workspace",
        hidden: "declared"
      },
      { id: "uuid-1", url: "https://manual.example/", scope: "global", hidden: "stored" }
    ]);

    await registry.unhideEnvironment("workspace", "settings:ci");
    await registry.unhideEnvironment("global", "uuid-1");

    expect(await registry.listHiddenEnvironments()).toEqual([]);
    expect(state.listHiddenStored()).toEqual([]);
    expect((await store.listEnvironmentsWithScope()).map(({ id }) => id)).toEqual([
      "settings:ci",
      "settings:gone",
      "uuid-1"
    ]);
    expect(changes).toEqual([
      { kind: "environment-added", scope: "workspace", environmentId: "settings:ci" },
      { kind: "environment-added", scope: "global", environmentId: "uuid-1" }
    ]);
  });

  it("announces a declared URL or TLS change as an environment update", () => {
    const { state, changes, registry } = setup([
      declared("ci", "https://ci.example/", { scope: "global", allowInsecureTls: true })
    ]);

    registry.notifyDeclaredEnvironmentUpdated("global", "settings:ci", {
      urlChanged: false,
      tlsPolicyChanged: true
    });
    registry.notifyDeclaredEnvironmentUpdated("global", "settings:missing", { urlChanged: true });

    expect(changes).toEqual([
      {
        kind: "environment-updated",
        scope: "global",
        environmentId: "settings:ci",
        urlChanged: false,
        tlsPolicyChanged: true,
        environment: {
          id: "settings:ci",
          url: "https://ci.example/",
          allowInsecureTls: true,
          source: "settings"
        }
      }
    ]);
    expect(state.get("global", "settings:ci")).toEqual({});
  });
});

describe("JenkinsEnvironmentStore secret keys", () => {
  /** Two workspaces: separate workspaceState, one shared (global) SecretStorage. */
  function setupTwoWorkspaces(declarationsA: DeclaredEnvironment[], declarationsB = declarationsA) {
    const secrets = createFakeSecretStorage();
    const globalState = createExtensionContext().globalState;
    const open = (declarations: DeclaredEnvironment[]) => {
      const context = createExtensionContext({ secrets, globalState });
      return { context, ...createDeclared(context, createFakeSource(declarations).source) };
    };
    return { secrets, a: open(declarationsA), b: open(declarationsB) };
  }

  it("namespaces workspace-declared secrets per workspace and keeps other keys", async () => {
    const { context, secrets, store } = setup([
      declared("ci", "https://ci.example/"),
      declared("personal", "https://personal.example/", { scope: "global" })
    ]);
    await store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "t" });
    await store.setToken("workspace", "settings:ci", "legacy");
    await store.setAuthConfig("global", "settings:personal", { type: "bearer", token: "p" });
    await store.setAuthConfig("workspace", "uuid-1", { type: "bearer", token: "u" });

    const namespace = context.workspaceState.get<string>(
      "jenkinsWorkbench.workspaceSecretNamespace"
    );
    expect(namespace).toMatch(/^[0-9a-f-]{36}$/);
    expect([...secrets.values.keys()].sort()).toEqual(
      [
        `jenkinsWorkbench.envAuthConfig.workspace.${namespace}.settings:ci`,
        `jenkinsWorkbench.envToken.workspace.${namespace}.settings:ci`,
        "jenkinsWorkbench.envAuthConfig.global.settings:personal",
        "jenkinsWorkbench.envAuthConfig.workspace.uuid-1"
      ].sort()
    );
    expect(await store.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "t"
    });
  });

  it("does not share a declared slug's credentials between workspaces", async () => {
    const { a, b } = setupTwoWorkspaces(
      [declared("ci", "https://a.example/", { authHint: { type: "bearer" } })],
      [declared("ci", "https://b.example/", { authHint: { type: "bearer" } })]
    );
    await a.registry.acknowledgeOrigin("workspace", "settings:ci");
    await a.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "a" });
    await b.registry.acknowledgeOrigin("workspace", "settings:ci");

    expect(await b.store.getAuthConfig("workspace", "settings:ci")).toBeUndefined();
    expect(await b.store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");
    expect(await a.store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("keeps another workspace's credentials when a declared environment is hidden", async () => {
    const { secrets, a, b } = setupTwoWorkspaces([declared("ci", "https://ci.example/")]);
    await a.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "a" });
    await a.store.setToken("workspace", "settings:ci", "legacy-a");
    await b.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "b" });

    expect(await b.registry.hideDeclaredEnvironment("workspace", "settings:ci")).toBe(true);

    expect(await b.store.getAuthConfig("workspace", "settings:ci")).toBeUndefined();
    expect(await a.store.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "a"
    });
    expect(await a.store.getToken("workspace", "settings:ci")).toBe("legacy-a");
    expect(secrets.values.size).toBe(2);
  });
});

describe("JenkinsEnvironmentStore credential presence memo", () => {
  function countReads(secrets: ReturnType<typeof createFakeSecretStorage>) {
    const counter = { reads: 0 };
    const get = secrets.get.bind(secrets);
    secrets.get = async (key: string) => {
      counter.reads += 1;
      return get(key);
    };
    return counter;
  }

  it("reads secrets once until the credentials change", async () => {
    const { store, secrets } = setup();
    await store.addEnvironment("global", {
      id: "env-1",
      url: "https://a.example/",
      authHint: { type: "basic" }
    });
    const counter = countReads(secrets);

    expect(await store.getSignInRequirement("global", "env-1")).toBe("credentials");
    expect(await store.getSignInRequirement("global", "env-1")).toBe("credentials");
    // Auth config and legacy token, once.
    expect(counter.reads).toBe(2);

    await store.setAuthConfig("global", "env-1", { type: "basic", username: "u", token: "t" });
    counter.reads = 0;
    expect(await store.getSignInRequirement("global", "env-1")).toBe("none");
    expect(await store.getSignInRequirement("global", "env-1")).toBe("none");
    expect(counter.reads).toBe(1);

    await store.deleteAuthConfig("global", "env-1");
    expect(await store.getSignInRequirement("global", "env-1")).toBe("credentials");

    await store.setToken("global", "env-1", "legacy");
    expect(await store.getSignInRequirement("global", "env-1")).toBe("none");

    await store.deleteToken("global", "env-1");
    expect(await store.getSignInRequirement("global", "env-1")).toBe("credentials");
  });

  it("forgets memoized results when secrets change in another window", async () => {
    const listeners: Array<(event: { key: string }) => void> = [];
    const secrets = {
      ...createFakeSecretStorage(),
      onDidChange: (listener: (event: { key: string }) => void) => {
        listeners.push(listener);
        return { dispose: () => undefined };
      }
    };
    const context = createExtensionContext({ secrets });
    const store = new JenkinsEnvironmentStore(context);
    await store.addEnvironment("global", {
      id: "env-1",
      url: "https://a.example/",
      authHint: { type: "bearer" }
    });
    expect(await store.getSignInRequirement("global", "env-1")).toBe("credentials");

    secrets.values.set(
      "jenkinsWorkbench.envAuthConfig.global.env-1",
      JSON.stringify({ type: "bearer", token: "t" })
    );
    for (const listener of listeners) {
      listener({ key: "jenkinsWorkbench.envAuthConfig.global.env-1" });
    }

    expect(await store.getSignInRequirement("global", "env-1")).toBe("none");
  });
});

describe("JenkinsEnvironmentStore SSO sign-in page acknowledgment", () => {
  const sso = (loginUrl: string): EnvironmentAuthHint => ({ type: "sso", loginUrl });

  it("covers a separate sign-in page origin and asks again when it changes", async () => {
    const { store, state, fake, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: sso("https://login.corp.example/sso") })
    ]);
    await state.acknowledgeOrigin("workspace", "settings:ci", "https://ci.example");
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");

    expect(await registry.acknowledgeOrigin("workspace", "settings:ci")).toBe(true);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://ci.example|https://login.corp.example"
    );
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");

    // Same sign-in origin, other path: still confirmed.
    fake.set([
      declared("ci", "https://ci.example/", { authHint: sso("https://login.corp.example/other") })
    ]);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");

    fake.set([
      declared("ci", "https://ci.example/", { authHint: sso("https://evil.example/login") })
    ]);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");
  });

  it("acknowledges just the server when the sign-in page is on the same origin", async () => {
    const { registry } = setup([
      declared("ci", "https://ci.example/", { authHint: sso("https://ci.example/securityRealm") })
    ]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe("https://ci.example");
  });

  it("records nothing when the declaration changed from what was confirmed", async () => {
    const { fake, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: sso("https://login.example/") })
    ]);
    fake.set([declared("ci", "https://ci.example/", { authHint: sso("https://evil.example/") })]);

    expect(
      await registry.acknowledgeOrigin("workspace", "settings:ci", {
        expected: "https://ci.example|https://login.example"
      })
    ).toBe(false);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
  });

  it("trusts the sign-in page from credentials only when they already sign in there", async () => {
    const { store, registry } = setup([
      declared("ci", "https://ci.example/", { authHint: sso("https://login.example/a") }),
      declared("cd", "https://cd.example/", { authHint: sso("https://login.example/a") })
    ]);
    await store.setAuthConfig("workspace", "settings:ci", {
      type: "sso",
      loginUrl: "https://login.example/b",
      headers: {}
    });
    await store.setAuthConfig("workspace", "settings:cd", {
      type: "basic",
      username: "u",
      token: "t"
    });

    await registry.acknowledgeOrigin("workspace", "settings:ci", { loginPage: "from-credentials" });
    await registry.acknowledgeOrigin("workspace", "settings:cd", { loginPage: "from-credentials" });

    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
    expect(registry.getAcknowledgedOrigin("workspace", "settings:cd")).toBe("https://cd.example");
    expect(await store.getSignInRequirement("workspace", "settings:cd")).toBe("confirm-origin");
  });
});

describe("JenkinsEnvironmentStore.unhideEnvironment for linked stored environments", () => {
  it("keeps the same-URL declaration listed beside the restored record", async () => {
    const { store, state, registry } = setup([
      declared("ci", "https://ci.example/"),
      declared("ci-user", "https://CI.example/", { scope: "global" }),
      declared("other", "https://other.example/"),
      declared("ci-hidden", "https://ci.example/")
    ]);
    await store.addEnvironment("global", { id: "uuid-1", url: "https://ci.example" });
    await state.setHidden("workspace", "settings:ci-hidden", true);
    // Linked: the stored record is hidden here and the declaration took over.
    await state.hideStored("global", "uuid-1");
    expect((await store.listEnvironmentsWithScope()).map(({ id }) => id)).toEqual([
      "settings:ci",
      "settings:other",
      "settings:ci-user"
    ]);

    await registry.unhideEnvironment("global", "uuid-1");

    expect((await store.listEnvironmentsWithScope()).map(({ id }) => id)).toEqual([
      "settings:ci",
      "settings:other",
      "uuid-1",
      "settings:ci-user"
    ]);
    expect(state.get("workspace", "settings:ci").adoptDeclined).toBe(true);
    expect(state.get("global", "settings:ci-user").adoptDeclined).toBe(true);
    expect(state.get("workspace", "settings:other").adoptDeclined).toBeUndefined();
    // A hidden declaration is kept separate too, so showing it later does not suppress it.
    expect(state.get("workspace", "settings:ci-hidden").adoptDeclined).toBe(true);
  });
});

describe("DeclaredEnvironmentRegistry origin acknowledgment", () => {
  it("answers from the current declaration, as the sign-in requirement does", async () => {
    const harness = setup([
      declared("ci", "https://ci.example/", {
        authHint: { type: "sso", loginUrl: "https://sso.example/login" }
      })
    ]);
    const { fake, store, registry } = harness;
    const expected = "https://ci.example|https://sso.example";

    expect(registry.getExpectedAcknowledgment("workspace", "settings:ci")).toBe(expected);
    expect(registry.isOriginAcknowledged("workspace", "settings:ci")).toBe(false);
    expect(await registry.acknowledgeOrigin("workspace", "settings:ci", { expected })).toBe(true);
    expect(registry.isOriginAcknowledged("workspace", "settings:ci")).toBe(true);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("credentials");

    // The repository moves the sign-in page: the old confirmation no longer covers it.
    fake.set([
      declared("ci", "https://ci.example/", {
        authHint: { type: "sso", loginUrl: "https://idp.example/login" }
      })
    ]);
    expect(registry.getExpectedAcknowledgment("workspace", "settings:ci")).toBe(
      "https://ci.example|https://idp.example"
    );
    expect(registry.isOriginAcknowledged("workspace", "settings:ci")).toBe(false);
    expect(await store.getSignInRequirement("workspace", "settings:ci")).toBe("confirm-origin");
    expect(await registry.acknowledgeOrigin("workspace", "settings:ci", { expected })).toBe(false);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(expected);

    expect(registry.getExpectedAcknowledgment("workspace", "uuid-1")).toBeUndefined();
    expect(registry.isOriginAcknowledged("workspace", "uuid-1")).toBe(false);
    expect(registry.getExpectedAcknowledgment("workspace", "settings:missing")).toBeUndefined();
  });
});

describe("DeclaredEnvironmentRegistry writes", () => {
  it("drops the cached client whenever it changes what the sign-in check reads", async () => {
    const { store, registry, invalidateClient } = setup([declared("ci", "https://ci.example/")]);
    await store.addEnvironment("global", { id: "uuid-1", url: "https://manual.example/" });

    await registry.acknowledgeOrigin("workspace", "settings:ci");
    await registry.hideDeclaredEnvironment("workspace", "settings:ci");
    await registry.unhideEnvironment("workspace", "settings:ci");
    await registry.hideStoredEnvironment("global", "uuid-1");

    expect(invalidateClient.mock.calls).toEqual([
      ["workspace", "settings:ci"],
      ["workspace", "settings:ci"],
      ["workspace", "settings:ci"],
      ["global", "uuid-1"]
    ]);
    expect(await registry.acknowledgeOrigin("workspace", "settings:missing")).toBe(false);
    expect(invalidateClient).toHaveBeenCalledTimes(4);
  });

  it("restores an acknowledgment only while the write it undoes still stands", async () => {
    const { registry, invalidateClient } = setup([declared("ci", "https://ci.example/")]);
    await registry.acknowledgeOrigin("workspace", "settings:ci");
    invalidateClient.mockClear();

    expect(
      await registry.restoreAcknowledgedOrigin("workspace", "settings:ci", undefined, {
        onlyIf: "https://other.example"
      })
    ).toBe(false);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe("https://ci.example");
    expect(invalidateClient).not.toHaveBeenCalled();

    expect(
      await registry.restoreAcknowledgedOrigin("workspace", "settings:ci", undefined, {
        onlyIf: "https://ci.example"
      })
    ).toBe(true);
    expect(registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(invalidateClient).toHaveBeenCalledWith("workspace", "settings:ci");
    expect(await registry.restoreAcknowledgedOrigin("global", "uuid-1", "https://x.example")).toBe(
      false
    );
  });

  it("keeps a declaration separate and lists it beside the same-URL manual environment", async () => {
    const { store, state, registry, changes } = setup([declared("ci", "https://ci.example/")]);
    await store.addEnvironment("global", { id: "uuid-1", url: "https://ci.example/" });
    expect(await store.getEnvironments("workspace")).toEqual([]);
    changes.length = 0;

    await registry.keepSeparate({ scope: "workspace", id: "settings:ci" });

    expect(state.get("workspace", "settings:ci").adoptDeclined).toBe(true);
    expect(changes).toEqual([{ kind: "bulk-update" }]);
    expect((await store.getEnvironments("workspace")).map(({ id }) => id)).toEqual(["settings:ci"]);
  });
});
