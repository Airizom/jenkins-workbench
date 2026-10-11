import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { describe, it } from "vitest";
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
  it("reads a complete revision while a concurrent save removes a later secret", async () => {
    const { store, secrets } = createStore();
    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Original",
      values: { BRANCH: "main" },
      secretValues: { FIRST: "first-secret", SECOND: "second-secret" }
    });
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    let resumeRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      resumeRead = resolve;
    });
    const getSecret = secrets.get;
    let firstRead = true;
    secrets.get = async (key) => {
      if (firstRead) {
        firstRead = false;
        markReadStarted();
        await readGate;
      }
      return getSecret(key);
    };

    const reading = store.getPreset("workspace", "env-1", JOB_URL, saved.id);
    await readStarted;
    const saving = store.savePreset("workspace", "env-1", JOB_URL, {
      id: saved.id,
      name: "Updated",
      values: { BRANCH: "release" },
      secretValues: {},
      keepSecretNames: ["FIRST"]
    });
    // Let the save progress while the first secret read is paused.
    await setImmediate();
    resumeRead();

    const [preset, updated] = await Promise.all([reading, saving]);
    assert.deepEqual(preset, {
      ...saved,
      values: { BRANCH: "main", FIRST: "first-secret", SECOND: "second-secret" }
    });
    assert.deepEqual(await store.getPreset("workspace", "env-1", JOB_URL, saved.id), {
      ...updated,
      values: { BRANCH: "release", FIRST: "first-secret" }
    });
    assert.equal(secrets.values.size, 1);
  });

  it.each(["implicit", "explicit"] as const)(
    "retains secrets named after inherited properties with %s preservation",
    async (preservation) => {
      const { store, secrets } = createStore();
      const secretValues = {
        constructor: "constructor-secret",
        toString: "toString-secret",
        valueOf: "valueOf-secret"
      };
      const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
        name: "Preset 1",
        values: {},
        secretValues
      });
      const originalSecrets = new Map(secrets.values);

      await store.savePreset("workspace", "env-1", JOB_URL, {
        id: saved.id,
        name: "Preset 1",
        values: {},
        ...(preservation === "explicit"
          ? { secretValues: {}, keepSecretNames: Object.keys(secretValues) }
          : {})
      });

      assert.deepEqual(
        (await store.getPreset("workspace", "env-1", JOB_URL, saved.id))?.values,
        secretValues
      );
      assert.deepEqual(secrets.values, originalSecrets);
    }
  );

  it("preserves every preset and secret when a URL merge exceeds the save limit", async () => {
    const { store, secrets } = createStore();
    const newJobUrl = "https://jenkins.example/job/renamed/";
    const sourcePresets = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.savePreset("workspace", "env-1", JOB_URL, {
          name: `Source ${index}`,
          values: {},
          secretValues: { TOKEN: `source-${index}` }
        })
      )
    );
    const targetPreset = await store.savePreset("workspace", "env-1", newJobUrl, {
      name: "Target",
      values: {},
      secretValues: { TOKEN: "target" }
    });

    assert.equal(await store.updatePresetUrl("workspace", "env-1", JOB_URL, newJobUrl), true);
    assert.deepEqual(await store.listPresets("workspace", "env-1", JOB_URL), []);
    const merged = await store.listPresets("workspace", "env-1", newJobUrl);
    assert.deepEqual(
      new Set(merged.map((preset) => preset.id)),
      new Set([...sourcePresets, targetPreset].map((preset) => preset.id))
    );
    for (const [index, preset] of sourcePresets.entries()) {
      assert.deepEqual(
        (await store.getPreset("workspace", "env-1", newJobUrl, preset.id))?.values,
        { TOKEN: `source-${index}` }
      );
    }
    assert.deepEqual(
      (await store.getPreset("workspace", "env-1", newJobUrl, targetPreset.id))?.values,
      { TOKEN: "target" }
    );
    assert.equal(secrets.values.size, 21);
  });

  it("renames incoming presets whose names collide during a URL merge", async () => {
    const { store, secrets } = createStore();
    const newJobUrl = "https://jenkins.example/job/renamed/";
    const source = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "release",
      values: {},
      secretValues: { TOKEN: "source" }
    });
    await store.savePreset("workspace", "env-1", newJobUrl, { name: "Release", values: {} });
    await store.savePreset("workspace", "env-1", newJobUrl, { name: "RELEASE (2)", values: {} });

    assert.equal(await store.updatePresetUrl("workspace", "env-1", JOB_URL, newJobUrl), true);
    const merged = await store.listPresets("workspace", "env-1", newJobUrl);
    const names = merged.map((preset) => preset.name.toLocaleLowerCase());
    assert.equal(new Set(names).size, names.length);
    assert.equal(merged.find((preset) => preset.id === source.id)?.name, "release (3)");

    const saved = await store.savePreset("workspace", "env-1", newJobUrl, {
      id: source.id,
      name: "release (3)",
      values: {}
    });
    assert.equal(saved.id, source.id);
    assert.deepEqual((await store.getPreset("workspace", "env-1", newJobUrl, source.id))?.values, {
      TOKEN: "source"
    });
    assert.equal(secrets.values.size, 1);
  });

  it("reassigns colliding incoming IDs and keeps merged presets independently addressable", async () => {
    const { store, secrets } = createStore();
    const newJobUrl = "https://jenkins.example/job/renamed/";
    for (const [jobUrl, name] of [
      [JOB_URL, "Source"],
      [newJobUrl, "Target"]
    ]) {
      await store.savePreset("workspace", "env-1", jobUrl, {
        id: "shared-id",
        name,
        values: { BRANCH: name },
        secretValues: { TOKEN: `${name}-secret` }
      });
    }
    const originalSecrets = new Map(secrets.values);

    assert.equal(await store.updatePresetUrl("workspace", "env-1", JOB_URL, newJobUrl), true);
    assert.deepEqual(await store.listPresets("workspace", "env-1", JOB_URL), []);
    const merged = await store.listPresets("workspace", "env-1", newJobUrl);
    assert.equal(merged.length, 2);
    assert.equal(new Set(merged.map((preset) => preset.id)).size, 2);
    const source = merged.find((preset) => preset.name === "Source");
    const target = merged.find((preset) => preset.name === "Target");
    assert.ok(source);
    assert.ok(target);
    assert.notEqual(source.id, "shared-id");
    assert.equal(target.id, "shared-id");
    assert.deepEqual(secrets.values, originalSecrets);

    for (const preset of [source, target]) {
      assert.deepEqual(
        (await store.getPreset("workspace", "env-1", newJobUrl, preset.id))?.values,
        { BRANCH: preset.name, TOKEN: `${preset.name}-secret` }
      );
      assert.equal(
        await store.renamePreset(
          "workspace",
          "env-1",
          newJobUrl,
          preset.id,
          `${preset.name} renamed`
        ),
        true
      );
      assert.equal(
        (await store.getPreset("workspace", "env-1", newJobUrl, preset.id))?.name,
        `${preset.name} renamed`
      );
    }

    await store.savePreset("workspace", "env-1", newJobUrl, {
      id: source.id,
      name: "Source updated",
      values: { BRANCH: "release" }
    });
    assert.deepEqual((await store.getPreset("workspace", "env-1", newJobUrl, source.id))?.values, {
      BRANCH: "release",
      TOKEN: "Source-secret"
    });
    assert.deepEqual((await store.getPreset("workspace", "env-1", newJobUrl, target.id))?.values, {
      BRANCH: "Target",
      TOKEN: "Target-secret"
    });

    assert.equal(await store.deletePreset("workspace", "env-1", newJobUrl, source.id), true);
    assert.equal(await store.getPreset("workspace", "env-1", newJobUrl, source.id), undefined);
    assert.deepEqual((await store.getPreset("workspace", "env-1", newJobUrl, target.id))?.values, {
      BRANCH: "Target",
      TOKEN: "Target-secret"
    });
    assert.equal(secrets.values.size, 1);
    assert.equal(await store.deletePreset("workspace", "env-1", newJobUrl, target.id), true);
    assert.deepEqual(await store.listPresets("workspace", "env-1", newJobUrl), []);
    assert.equal(secrets.values.size, 0);
  });

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
