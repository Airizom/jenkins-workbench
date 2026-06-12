import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import {
  createExtensionContext,
  createFakeSecretStorage,
  type FakeSecretStorage
} from "./helpers/storageMocks";

function createStore(): { store: JenkinsParameterPresetStore; secrets: FakeSecretStorage } {
  const secrets = createFakeSecretStorage();
  const context = createExtensionContext({ secrets });
  return { store: new JenkinsParameterPresetStore(context), secrets };
}

const JOB_URL = "https://jenkins.example/job/demo/";

function savePresetWithToken(
  store: JenkinsParameterPresetStore,
  options: { token?: string; values?: Record<string, string> } = {}
) {
  return store.savePreset("workspace", "env-1", JOB_URL, {
    name: "Preset 1",
    values: options.values ?? { BRANCH: "main" },
    secretValues: { TOKEN: options.token ?? "s3cret" }
  });
}

describe("JenkinsParameterPresetStore secret handling", () => {
  it("keeps a stored secret when an update lists the parameter in keepSecretNames", async () => {
    const { store, secrets } = createStore();

    const saved = await savePresetWithToken(store);
    assert.equal(secrets.values.size, 1);

    await store.savePreset("workspace", "env-1", JOB_URL, {
      id: saved.id,
      name: "Preset 1",
      values: { BRANCH: "release" },
      secretValues: {},
      keepSecretNames: ["TOKEN"]
    });

    const preset = await store.getPreset("workspace", "env-1", JOB_URL, saved.id);
    assert.deepEqual(preset?.values, { BRANCH: "release", TOKEN: "s3cret" });
    assert.equal(secrets.values.size, 1);
  });

  it("deletes a stored secret when its parameter is no longer part of the preset", async () => {
    const { store, secrets } = createStore();

    const saved = await savePresetWithToken(store);

    await store.savePreset("workspace", "env-1", JOB_URL, {
      id: saved.id,
      name: "Preset 1",
      values: { BRANCH: "main" },
      secretValues: {},
      keepSecretNames: []
    });

    const preset = await store.getPreset("workspace", "env-1", JOB_URL, saved.id);
    assert.deepEqual(preset?.values, { BRANCH: "main" });
    assert.equal(secrets.values.size, 0);
  });

  it("replaces a stored secret when a new value is saved for the parameter", async () => {
    const { store, secrets } = createStore();

    const saved = await savePresetWithToken(store, { token: "old", values: {} });

    await store.savePreset("workspace", "env-1", JOB_URL, {
      id: saved.id,
      name: "Preset 1",
      values: {},
      secretValues: { TOKEN: "new" },
      keepSecretNames: []
    });

    const preset = await store.getPreset("workspace", "env-1", JOB_URL, saved.id);
    assert.deepEqual(preset?.values, { TOKEN: "new" });
    assert.equal(secrets.values.size, 1);
  });

  it("preserves all stored secrets when secretValues is undefined", async () => {
    const { store, secrets } = createStore();

    const saved = await savePresetWithToken(store);

    await store.savePreset("workspace", "env-1", JOB_URL, {
      id: saved.id,
      name: "Renamed",
      values: { BRANCH: "main" }
    });

    const preset = await store.getPreset("workspace", "env-1", JOB_URL, saved.id);
    assert.equal(preset?.name, "Renamed");
    assert.deepEqual(preset?.values, { BRANCH: "main", TOKEN: "s3cret" });
    assert.equal(secrets.values.size, 1);
  });

  it("deletes stored secrets when the preset is deleted", async () => {
    const { store, secrets } = createStore();

    const saved = await savePresetWithToken(store, { values: {} });

    await store.deletePreset("workspace", "env-1", JOB_URL, saved.id);

    assert.equal(secrets.values.size, 0);
  });
});
