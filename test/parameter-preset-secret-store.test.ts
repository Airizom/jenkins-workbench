import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ParameterPresetSecretStore } from "../src/storage/ParameterPresetSecretStore";
import { createFakeSecretStorage, type FakeSecretStorage } from "./helpers/storageMocks";

const LOCATION = {
  scope: "workspace" as const,
  environmentId: "env-1",
  jobUrl: "https://jenkins.example/job/demo/",
  presetId: "preset-1"
};

function createStore(): { store: ParameterPresetSecretStore; secrets: FakeSecretStorage } {
  const secrets = createFakeSecretStorage();
  return { store: new ParameterPresetSecretStore(secrets), secrets };
}

describe("ParameterPresetSecretStore.prepare", () => {
  it("stores provided secret values and strips them from the plain values", async () => {
    const { store, secrets } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: { BRANCH: "main", TOKEN: "typed-in-plain" },
      secretValues: { TOKEN: "s3cret" }
    });

    assert.deepEqual(prepared.values, { BRANCH: "main" });
    assert.deepEqual(Object.keys(prepared.secretKeys), ["TOKEN"]);
    assert.deepEqual(prepared.newlyStoredKeys, [prepared.secretKeys.TOKEN]);
    assert.equal(secrets.values.get(prepared.secretKeys.TOKEN), JSON.stringify("s3cret"));
  });

  it("migrates values of previously secret parameters when secretValues is omitted", async () => {
    const { store, secrets } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: { BRANCH: "main", TOKEN: "updated-secret" },
      previousSecretKeys: { TOKEN: "old-key" }
    });

    assert.deepEqual(prepared.values, { BRANCH: "main" });
    assert.notEqual(prepared.secretKeys.TOKEN, "old-key");
    assert.deepEqual(prepared.newlyStoredKeys, [prepared.secretKeys.TOKEN]);
    assert.equal(secrets.values.get(prepared.secretKeys.TOKEN), JSON.stringify("updated-secret"));
  });

  it("carries over previous secret keys when secretValues is omitted and no value is present", async () => {
    const { store, secrets } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: { BRANCH: "main" },
      previousSecretKeys: { TOKEN: "old-key" }
    });

    assert.deepEqual(prepared.values, { BRANCH: "main" });
    assert.deepEqual(prepared.secretKeys, { TOKEN: "old-key" });
    assert.deepEqual(prepared.newlyStoredKeys, []);
    assert.equal(secrets.values.size, 0);
  });

  it("drops a previous secret that is neither replaced nor kept", async () => {
    const { store, secrets } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: { TOKEN: "typed-in-plain" },
      secretValues: {},
      keepSecretNames: [],
      previousSecretKeys: { TOKEN: "old-key" }
    });

    assert.deepEqual(prepared.values, {});
    assert.deepEqual(prepared.secretKeys, {});
    assert.deepEqual(prepared.newlyStoredKeys, []);
    assert.equal(secrets.values.size, 0);
  });

  it("keeps only the previous secret keys listed in keepSecretNames", async () => {
    const { store } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: {},
      secretValues: {},
      keepSecretNames: ["TOKEN"],
      previousSecretKeys: { TOKEN: "token-key", OTHER: "other-key" }
    });

    assert.deepEqual(prepared.secretKeys, { TOKEN: "token-key" });
  });

  it("prefers freshly stored secrets over carried-over previous keys", async () => {
    const { store, secrets } = createStore();

    const prepared = await store.prepare({
      ...LOCATION,
      values: {},
      secretValues: { TOKEN: "replacement" },
      keepSecretNames: ["TOKEN"],
      previousSecretKeys: { TOKEN: "old-key" }
    });

    assert.notEqual(prepared.secretKeys.TOKEN, "old-key");
    assert.equal(secrets.values.get(prepared.secretKeys.TOKEN), JSON.stringify("replacement"));
  });

  it("rolls back already stored secrets when a store operation fails", async () => {
    const inner = createFakeSecretStorage();
    let storeCalls = 0;
    const failing: FakeSecretStorage = {
      ...inner,
      store: async (key, value) => {
        storeCalls += 1;
        if (storeCalls === 2) {
          throw new Error("secret storage unavailable");
        }
        await inner.store(key, value);
      }
    };
    const store = new ParameterPresetSecretStore(failing);

    await assert.rejects(
      store.prepare({
        ...LOCATION,
        values: {},
        secretValues: { FIRST: "one", SECOND: "two" }
      }),
      /secret storage unavailable/
    );

    assert.equal(inner.values.size, 0);
  });
});
