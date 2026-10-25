import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.doMock("vscode", () => ({ workspace: { getConfiguration: () => undefined } }));
const { getBoundedIntegerConfigValue, getClampedIntegerConfigValue } = await import(
  "../src/extension/ExtensionConfigValueReaders"
);
const { getArtifactMaxDownloadBytes } = await import("../src/extension/ExtensionConfig");

function createConfig(values: Record<string, unknown>): vscode.WorkspaceConfiguration {
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      Object.hasOwn(values, key) ? (values[key] as T) : (defaultValue as T)
  } as vscode.WorkspaceConfiguration;
}

describe("integer config value readers", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, "12", null])(
    "falls back to the default for non-finite value %j",
    (invalid) => {
      const config = createConfig({ key: invalid });
      assert.equal(getBoundedIntegerConfigValue(config, "key", 7, 1), 7);
      assert.equal(getClampedIntegerConfigValue(config, "key", 7, 1, 10), 7);
    }
  );

  it("floors and applies the minimum on the bounded path", () => {
    assert.equal(getBoundedIntegerConfigValue(createConfig({ key: 4.9 }), "key", 7, 1), 4);
    assert.equal(getBoundedIntegerConfigValue(createConfig({ key: 0.5 }), "key", 7, 1), 1);
    assert.equal(
      getBoundedIntegerConfigValue(createConfig({ key: 1_000_000.7 }), "key", 7, 1),
      1_000_000
    );
  });

  it("floors and clamps on the clamped path", () => {
    assert.equal(getClampedIntegerConfigValue(createConfig({ key: 4.9 }), "key", 7, 1, 10), 4);
    assert.equal(getClampedIntegerConfigValue(createConfig({ key: -3 }), "key", 7, 1, 10), 1);
    assert.equal(getClampedIntegerConfigValue(createConfig({ key: 25 }), "key", 7, 1, 10), 10);
  });
});

describe("artifact max download bytes", () => {
  it("converts megabytes to whole bytes", () => {
    assert.equal(
      getArtifactMaxDownloadBytes(createConfig({ artifactMaxDownloadMb: 1.5 })),
      1.5 * 1024 * 1024
    );
  });

  it("disables the limit for zero or negative values", () => {
    assert.equal(
      getArtifactMaxDownloadBytes(createConfig({ artifactMaxDownloadMb: 0 })),
      undefined
    );
    assert.equal(
      getArtifactMaxDownloadBytes(createConfig({ artifactMaxDownloadMb: -1 })),
      undefined
    );
  });

  it("uses the default limit for non-finite values", () => {
    assert.equal(
      getArtifactMaxDownloadBytes(createConfig({ artifactMaxDownloadMb: Number.NaN })),
      100 * 1024 * 1024
    );
  });
});
