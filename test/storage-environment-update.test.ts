import { describe, expect, it } from "vitest";
import {
  JenkinsEnvironmentStore,
  type JenkinsEnvironmentStoreChange
} from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext } from "./helpers/storageMocks";

function setup() {
  const store = new JenkinsEnvironmentStore(createExtensionContext());
  const changes: JenkinsEnvironmentStoreChange[] = [];
  store.onDidChange((change) => {
    changes.push(change);
  });
  return { store, changes };
}

describe("JenkinsEnvironmentStore.updateEnvironment", () => {
  it("records previous URLs newest first and drops the current URL across A -> B -> A", async () => {
    const { store } = setup();
    await store.addEnvironment("workspace", { id: "env-1", url: "https://a.example" });

    const first = await store.updateEnvironment("workspace", "env-1", {
      url: "https://b.example"
    });
    expect(first?.previous).toEqual({ id: "env-1", url: "https://a.example" });
    expect(first?.next).toEqual({
      id: "env-1",
      url: "https://b.example",
      previousUrls: ["https://a.example/"]
    });

    const second = await store.updateEnvironment("workspace", "env-1", {
      url: "https://a.example"
    });
    expect(second?.next).toEqual({
      id: "env-1",
      url: "https://a.example",
      previousUrls: ["https://b.example/"]
    });
    expect(await store.getEnvironments("workspace")).toEqual([second?.next]);
  });

  it("never records embedded credentials in previous URLs", async () => {
    const { store } = setup();
    await store.addEnvironment("workspace", {
      id: "env-1",
      url: "https://user:secret@legacy.example/jenkins/"
    });

    const updated = await store.updateEnvironment("workspace", "env-1", {
      url: "https://legacy.example/jenkins/"
    });

    expect(updated?.next.previousUrls).toEqual([]);
    expect(JSON.stringify(await store.getEnvironments("workspace"))).not.toContain("secret");
  });

  it("keeps at most five previous URLs", async () => {
    const { store } = setup();
    await store.addEnvironment("global", { id: "env-1", url: "https://h0.example/" });
    for (let index = 1; index <= 7; index += 1) {
      await store.updateEnvironment("global", "env-1", { url: `https://h${index}.example/` });
    }

    const [environment] = await store.getEnvironments("global");
    expect(environment.url).toBe("https://h7.example/");
    expect(environment.previousUrls).toEqual([
      "https://h6.example/",
      "https://h5.example/",
      "https://h4.example/",
      "https://h3.example/",
      "https://h2.example/"
    ]);
  });

  it("sets, trims, and clears the display name", async () => {
    const { store } = setup();
    await store.addEnvironment("workspace", { id: "env-1", url: "https://a.example" });

    const named = await store.updateEnvironment("workspace", "env-1", { name: "  Prod  " });
    expect(named?.next.name).toBe("Prod");

    const kept = await store.updateEnvironment("workspace", "env-1", {});
    expect(kept?.next.name).toBe("Prod");

    const blank = await store.updateEnvironment("workspace", "env-1", { name: "   " });
    expect(blank?.next).not.toHaveProperty("name");

    await store.updateEnvironment("workspace", "env-1", { name: "Prod" });
    const cleared = await store.updateEnvironment("workspace", "env-1", { name: null });
    expect(cleared?.next).not.toHaveProperty("name");
    expect(await store.getEnvironments("workspace")).toEqual([
      { id: "env-1", url: "https://a.example" }
    ]);
  });

  it("clears a legacy username when passed null", async () => {
    const { store } = setup();
    await store.addEnvironment("workspace", {
      id: "env-1",
      url: "https://a.example",
      username: "developer"
    });

    const unchanged = await store.updateEnvironment("workspace", "env-1", { name: "CI" });
    expect(unchanged?.next.username).toBe("developer");

    const cleared = await store.updateEnvironment("workspace", "env-1", { username: null });
    expect(cleared?.previous.username).toBe("developer");
    expect(cleared?.next).not.toHaveProperty("username");
  });

  it("emits environment-updated with urlChanged only when the URL changed", async () => {
    const { store, changes } = setup();
    await store.addEnvironment("global", { id: "env-1", url: "https://a.example" });
    changes.length = 0;

    await store.updateEnvironment("global", "env-1", { name: "CI" });
    await store.updateEnvironment("global", "env-1", { url: "https://a.example" });
    await store.updateEnvironment("global", "env-1", { url: "https://b.example" });

    expect(changes).toEqual([
      {
        kind: "environment-updated",
        scope: "global",
        environmentId: "env-1",
        urlChanged: false,
        environment: { id: "env-1", url: "https://a.example", name: "CI" }
      },
      {
        kind: "environment-updated",
        scope: "global",
        environmentId: "env-1",
        urlChanged: false,
        environment: { id: "env-1", url: "https://a.example", name: "CI" }
      },
      {
        kind: "environment-updated",
        scope: "global",
        environmentId: "env-1",
        urlChanged: true,
        environment: {
          id: "env-1",
          url: "https://b.example",
          name: "CI",
          previousUrls: ["https://a.example/"]
        }
      }
    ]);
    const [environment] = await store.getEnvironments("global");
    expect(environment.previousUrls).toEqual(["https://a.example/"]);
  });

  it("returns undefined for a missing id without writing or emitting", async () => {
    const { store, changes } = setup();
    await store.addEnvironment("workspace", { id: "env-1", url: "https://a.example" });
    changes.length = 0;

    expect(
      await store.updateEnvironment("workspace", "missing", { url: "https://b.example" })
    ).toBeUndefined();
    expect(await store.updateEnvironment("global", "env-1", { name: "CI" })).toBeUndefined();
    expect(changes).toEqual([]);
    expect(await store.getEnvironments("workspace")).toEqual([
      { id: "env-1", url: "https://a.example" }
    ]);
  });
});

describe("environment TLS policy", () => {
  it.each([undefined, false, "true", 1, null])(
    "does not enable insecure TLS for %s",
    async (value) => {
      const { store } = setup();
      await store.addEnvironment("workspace", {
        id: "env-1",
        url: "https://a.example/",
        allowInsecureTls: value as boolean
      });
      expect(store.getAllowInsecureTls("workspace", "env-1", "https://a.example/")).toBe(false);
    }
  );

  it("uses current stored policy and checks scope, identity, and origin", async () => {
    const { store, changes } = setup();
    await store.addEnvironment("workspace", { id: "env-1", url: "https://a.example/" });
    await store.updateEnvironment("workspace", "env-1", { allowInsecureTls: true });
    expect(store.getAllowInsecureTls("workspace", "env-1", "https://a.example/other")).toBe(true);
    expect(store.getAllowInsecureTls("global", "env-1", "https://a.example/")).toBe(false);
    expect(store.getAllowInsecureTls("workspace", "missing", "https://a.example/")).toBe(false);
    expect(store.getAllowInsecureTls("workspace", "env-1", "https://other.example/")).toBe(false);
    expect(store.getAllowInsecureTls("workspace", "env-1", "invalid")).toBe(false);
    expect(changes.at(-1)).toMatchObject({ tlsPolicyChanged: true, urlChanged: false });
    await store.updateEnvironment("workspace", "env-1", { allowInsecureTls: false });
    expect(store.getAllowInsecureTls("workspace", "env-1", "https://a.example/")).toBe(false);
    expect(changes.at(-1)).toMatchObject({ tlsPolicyChanged: true });
  });

  it.each(["https://b.example/", "https://a.example:8443/", "http://a.example/"])(
    "resets the exception before notifying when changing origin to %s",
    async (url) => {
      const { store, changes } = setup();
      await store.addEnvironment("workspace", {
        id: "env-1",
        url: "https://a.example/",
        allowInsecureTls: true
      });
      let observedPolicy: boolean | undefined;
      const update = await store.updateEnvironment(
        "workspace",
        "env-1",
        {
          url,
          allowInsecureTls: true
        },
        {
          beforeNotify: async () => {
            observedPolicy = store.getAllowInsecureTls("workspace", "env-1", url);
          }
        }
      );
      expect(update?.next.allowInsecureTls).toBeUndefined();
      expect(observedPolicy).toBe(false);
      expect(changes.at(-1)).toMatchObject({ tlsPolicyChanged: true, urlChanged: true });
    }
  );

  it("preserves the exception for path-only changes", async () => {
    const { store, changes } = setup();
    await store.addEnvironment("workspace", {
      id: "env-1",
      url: "https://a.example/",
      allowInsecureTls: true
    });
    await store.updateEnvironment("workspace", "env-1", { url: "https://a.example/jenkins/" });
    expect(store.getAllowInsecureTls("workspace", "env-1", "https://a.example/jenkins/")).toBe(
      true
    );
    expect(changes.at(-1)).not.toHaveProperty("tlsPolicyChanged");
  });

  it("never treats HTTP as having an insecure TLS exception", async () => {
    const { store } = setup();
    await store.addEnvironment("workspace", {
      id: "env-1",
      url: "http://a.example/",
      allowInsecureTls: true
    });
    expect(store.getAllowInsecureTls("workspace", "env-1", "http://a.example/")).toBe(false);
  });
});

it("does not apply TLS authorization for a previous origin", async () => {
  const { store } = setup();
  await store.addEnvironment("workspace", { id: "env-1", url: "https://new.example/" });
  expect(
    await store.updateEnvironment(
      "workspace",
      "env-1",
      { allowInsecureTls: true },
      {
        expectedTlsOrigin: "https://old.example"
      }
    )
  ).toBeUndefined();
  expect(store.getAllowInsecureTls("workspace", "env-1", "https://new.example/")).toBe(false);
});
