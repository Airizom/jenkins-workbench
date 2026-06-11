import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type * as vscode from "vscode";
import { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";

class FakeMemento {
  private readonly storage = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.storage.get(key) as T | undefined;
  }

  update(key: string, value: unknown): Promise<void> {
    this.storage.set(key, value);
    return Promise.resolve();
  }

  keys(): readonly string[] {
    return [...this.storage.keys()];
  }
}

class FakeSecretStorage {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createStore(): { store: JenkinsParameterPresetStore; secrets: FakeSecretStorage } {
  const secrets = new FakeSecretStorage();
  const context = {
    workspaceState: new FakeMemento(),
    globalState: new FakeMemento(),
    secrets
  } as unknown as vscode.ExtensionContext;
  return { store: new JenkinsParameterPresetStore(context), secrets };
}

const JOB_URL = "https://jenkins.example/job/demo/";

describe("JenkinsParameterPresetStore secret handling", () => {
  it("keeps a stored secret when an update lists the parameter in keepSecretNames", async () => {
    const { store, secrets } = createStore();

    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Preset 1",
      values: { BRANCH: "main" },
      secretValues: { TOKEN: "s3cret" }
    });
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

    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Preset 1",
      values: { BRANCH: "main" },
      secretValues: { TOKEN: "s3cret" }
    });

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

    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Preset 1",
      values: {},
      secretValues: { TOKEN: "old" }
    });

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

    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Preset 1",
      values: { BRANCH: "main" },
      secretValues: { TOKEN: "s3cret" }
    });

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

    const saved = await store.savePreset("workspace", "env-1", JOB_URL, {
      name: "Preset 1",
      values: {},
      secretValues: { TOKEN: "s3cret" }
    });

    await store.deletePreset("workspace", "env-1", JOB_URL, saved.id);

    assert.equal(secrets.values.size, 0);
  });
});
