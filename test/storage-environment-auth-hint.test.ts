import { describe, expect, it, vi } from "vitest";
import type { DeclaredEnvironmentSource } from "../src/environments/sharing/DeclaredEnvironmentSource";
import { createDeclaredEnvironmentView } from "../src/environments/sharing/DeclaredEnvironmentRegistry";
import { DeclaredEnvironmentStateStore } from "../src/environments/sharing/DeclaredEnvironmentStateStore";
import { toEnvironmentAuthHint } from "../src/storage/EnvironmentAuthHint";
import type { JenkinsAuthConfig } from "../src/jenkins/types";
import {
  type JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";

const ENVIRONMENTS_KEY = "jenkinsWorkbench.environments";
const BACKFILL_KEY = "jenkinsWorkbench.authHintBackfillVersion";

function setup(stored: JenkinsEnvironment[] = [{ id: "env-1", url: "https://ci.example/" }]) {
  const secrets = createFakeSecretStorage();
  const context = createExtensionContext({ secrets });
  void context.globalState.update(ENVIRONMENTS_KEY, stored);
  const store = new JenkinsEnvironmentStore(context);
  const read = () => context.globalState.get<JenkinsEnvironment[]>(ENVIRONMENTS_KEY) ?? [];
  return { context, secrets, store, read };
}

/** Record mutations are serialized; any later one has run after earlier queued hint writes. */
async function flushRecordMutations(store: JenkinsEnvironmentStore): Promise<void> {
  await store.updateEnvironment("global", "missing", {});
}

describe("JenkinsEnvironmentStore auth hints", () => {
  it.each<[JenkinsAuthConfig, unknown]>([
    [{ type: "none" }, { type: "none" }],
    [{ type: "basic", username: "ana", token: "secret" }, { type: "basic" }],
    [{ type: "bearer", token: "secret" }, { type: "bearer" }],
    [
      { type: "sso", loginUrl: "https://sso.example/login", headers: { Cookie: "a=b" } },
      { type: "sso", loginUrl: "https://sso.example/login" }
    ]
  ])("records the hint for a %j auth config on the stored record", async (config, hint) => {
    const { store, read } = setup();

    await store.setAuthConfig("global", "env-1", config);

    expect(read()[0].authHint).toEqual(hint);
    expect(JSON.stringify(read())).not.toContain("secret");
    expect(JSON.stringify(read())).not.toContain("a=b");
  });

  it.each<JenkinsAuthConfig>([
    { type: "cookie", cookie: "JSESSIONID=1" },
    { type: "headers", headers: { "X-Token": "1" } }
  ])("removes the hint for auth that a hint cannot describe (%j)", async (config) => {
    const { store, read } = setup([
      { id: "env-1", url: "https://ci.example/", authHint: { type: "basic" } }
    ]);

    await store.setAuthConfig("global", "env-1", config);

    expect(read()[0]).toEqual({ id: "env-1", url: "https://ci.example/" });
  });

  it("keeps the hint when the auth config is deleted, so the record asks for sign-in", async () => {
    const { store, read } = setup();
    await store.setAuthConfig("global", "env-1", { type: "bearer", token: "t" });

    await store.deleteAuthConfig("global", "env-1");

    expect(read()[0].authHint).toEqual({ type: "bearer" });
    await expect(store.getSignInRequirement("global", "env-1")).resolves.toBe("credentials");
  });

  it("strips credentials from an SSO sign-in URL before recording it", () => {
    expect(
      toEnvironmentAuthHint({
        type: "sso",
        loginUrl: "https://user:pw@sso.example/login",
        headers: {}
      })
    ).toEqual({ type: "sso", loginUrl: "https://sso.example/login" });
  });

  it("drops an SSO hint whose sign-in URL is not a valid http(s) URL", () => {
    for (const loginUrl of ["not a url", "ftp://sso.example/", "javascript:alert(1)"]) {
      expect(toEnvironmentAuthHint({ type: "sso", loginUrl, headers: {} })).toBeUndefined();
    }
  });

  it("writes only when the hint changes", async () => {
    const { context, store } = setup([
      { id: "env-1", url: "https://ci.example/", authHint: { type: "basic" } }
    ]);
    const update = vi.spyOn(context.globalState, "update");

    await store.setAuthConfig("global", "env-1", { type: "basic", username: "a", token: "b" });

    expect(update).not.toHaveBeenCalled();
  });

  it("records the hint after a revision-checked save and not after a stale one", async () => {
    const { store, read } = setup();
    const revision = store.getAuthConfigRevision("global", "env-1");
    await store.setAuthConfig("global", "env-1", { type: "none" });

    await expect(
      store.setAuthConfigIfRevision("global", "env-1", { type: "bearer", token: "t" }, revision)
    ).resolves.toBe(false);
    expect(read()[0].authHint).toEqual({ type: "none" });

    await expect(
      store.setAuthConfigIfRevision(
        "global",
        "env-1",
        { type: "bearer", token: "t" },
        store.getAuthConfigRevision("global", "env-1")
      )
    ).resolves.toBe(true);
    expect(read()[0].authHint).toEqual({ type: "bearer" });
  });

  it("never writes a hint for a settings-declared id", async () => {
    const context = createExtensionContext({ secrets: createFakeSecretStorage() });
    const source = {
      getDeclared: () => [],
      getDeclaration: () => undefined,
      onDidChange: () => ({ dispose: () => undefined })
    } as unknown as DeclaredEnvironmentSource;
    const store = new JenkinsEnvironmentStore(
      context,
      createDeclaredEnvironmentView({ source, state: new DeclaredEnvironmentStateStore(context) })
    );

    await store.setAuthConfig("workspace", "settings:ci", {
      type: "basic",
      username: "a",
      token: "b"
    });
    await flushRecordMutations(store);

    expect(context.workspaceState.get(ENVIRONMENTS_KEY)).toBeUndefined();
    expect(context.globalState.get(ENVIRONMENTS_KEY)).toBeUndefined();
  });

  it("persists a hint passed to addEnvironment", async () => {
    const { store, read } = setup([]);

    await store.addEnvironment("global", {
      id: "env-2",
      url: "https://other.example/",
      authHint: { type: "sso", loginUrl: "https://sso.example/" }
    });

    expect(read()).toEqual([
      {
        id: "env-2",
        url: "https://other.example/",
        authHint: { type: "sso", loginUrl: "https://sso.example/" }
      }
    ]);
  });

  it("records the hint of a migrated legacy token without deadlocking", async () => {
    const { store, read, secrets } = setup([
      { id: "env-1", url: "https://ci.example/", username: "ana" }
    ]);
    await store.setToken("global", "env-1", "legacy-token");

    await store.migrateLegacyAuthConfigs();
    await flushRecordMutations(store);

    expect(read()).toEqual([
      { id: "env-1", url: "https://ci.example/", authHint: { type: "basic" } }
    ]);
    expect([...secrets.values.keys()]).toEqual(["jenkinsWorkbench.envAuthConfig.global.env-1"]);
  });

  it("follows an SSO sign-in URL rebased inside a URL edit without deadlocking", async () => {
    const { store, read } = setup();
    await store.setAuthConfig("global", "env-1", {
      type: "sso",
      loginUrl: "https://ci.example/login",
      headers: {}
    });

    await store.updateEnvironment(
      "global",
      "env-1",
      { url: "https://ci2.example/" },
      {
        beforeNotify: async () => {
          await store.setAuthConfigIfRevision(
            "global",
            "env-1",
            { type: "sso", loginUrl: "https://ci2.example/login", headers: {} },
            store.getAuthConfigRevision("global", "env-1")
          );
        }
      }
    );
    await flushRecordMutations(store);

    expect(read()[0]).toMatchObject({
      url: "https://ci2.example/",
      authHint: { type: "sso", loginUrl: "https://ci2.example/login" }
    });
  });

  describe("backfillAuthHints", () => {
    it("gives hintless stored records the hint of their auth config", async () => {
      const { context, secrets, store, read } = setup([
        { id: "basic", url: "https://a.example/" },
        { id: "cookie", url: "https://b.example/" },
        { id: "no-auth", url: "https://c.example/" },
        { id: "hinted", url: "https://d.example/", authHint: { type: "bearer" } }
      ]);
      await secrets.store(
        "jenkinsWorkbench.envAuthConfig.global.basic",
        JSON.stringify({ type: "basic", username: "a", token: "b" })
      );
      await secrets.store(
        "jenkinsWorkbench.envAuthConfig.global.cookie",
        JSON.stringify({ type: "cookie", cookie: "c" })
      );
      await secrets.store(
        "jenkinsWorkbench.envAuthConfig.global.hinted",
        JSON.stringify({ type: "none" })
      );
      await context.workspaceState.update(ENVIRONMENTS_KEY, [
        { id: "ws", url: "https://e.example/" }
      ]);
      await secrets.store(
        "jenkinsWorkbench.envAuthConfig.workspace.ws",
        JSON.stringify({ type: "none" })
      );
      const get = vi.spyOn(secrets, "get");

      await store.backfillAuthHints();

      expect(read()).toEqual([
        { id: "basic", url: "https://a.example/", authHint: { type: "basic" } },
        { id: "cookie", url: "https://b.example/" },
        { id: "no-auth", url: "https://c.example/" },
        { id: "hinted", url: "https://d.example/", authHint: { type: "bearer" } }
      ]);
      expect(context.workspaceState.get(ENVIRONMENTS_KEY)).toEqual([
        { id: "ws", url: "https://e.example/", authHint: { type: "none" } }
      ]);
      // One secret read per hintless record; hinted records are not read.
      expect(get).toHaveBeenCalledTimes(4);
      expect(get).not.toHaveBeenCalledWith("jenkinsWorkbench.envAuthConfig.global.hinted");
    });

    it("reads no secrets and leaves records alone when every record has a hint", async () => {
      const { context, secrets, store } = setup([
        { id: "env-1", url: "https://ci.example/", authHint: { type: "none" } }
      ]);
      const get = vi.spyOn(secrets, "get");
      const update = vi.spyOn(context.globalState, "update");

      await store.backfillAuthHints();

      expect(get).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalledWith(ENVIRONMENTS_KEY, expect.anything());
      expect(context.globalState.get(BACKFILL_KEY)).toBe(1);
    });

    it("runs once per scope: a later activation reads no secrets", async () => {
      const { context, secrets, store, read } = setup([
        { id: "no-auth", url: "https://a.example/" }
      ]);
      await context.workspaceState.update(ENVIRONMENTS_KEY, [
        { id: "ws", url: "https://b.example/" }
      ]);
      await store.backfillAuthHints();
      expect(context.globalState.get(BACKFILL_KEY)).toBe(1);
      expect(context.workspaceState.get(BACKFILL_KEY)).toBe(1);

      const get = vi.spyOn(secrets, "get");
      await new JenkinsEnvironmentStore(context).backfillAuthHints();

      expect(get).not.toHaveBeenCalled();
      expect(read()).toEqual([{ id: "no-auth", url: "https://a.example/" }]);
    });

    it("retries on the next activation after a failed read", async () => {
      const { context, secrets, store, read } = setup([{ id: "basic", url: "https://a.example/" }]);
      await secrets.store(
        "jenkinsWorkbench.envAuthConfig.global.basic",
        JSON.stringify({ type: "basic", username: "a", token: "b" })
      );
      const get = vi.spyOn(secrets, "get").mockRejectedValueOnce(new Error("keychain locked"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await store.backfillAuthHints();
      expect(context.globalState.get(BACKFILL_KEY)).toBeUndefined();
      expect(read()).toEqual([{ id: "basic", url: "https://a.example/" }]);

      get.mockClear();
      await new JenkinsEnvironmentStore(context).backfillAuthHints();
      expect(get).toHaveBeenCalledTimes(1);
      expect(read()).toEqual([
        { id: "basic", url: "https://a.example/", authHint: { type: "basic" } }
      ]);
      expect(context.globalState.get(BACKFILL_KEY)).toBe(1);
      warn.mockRestore();
    });
  });
});
