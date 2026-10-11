import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";

vi.doMock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: <T>(_key: string, defaultValue?: T) => defaultValue })
  }
}));

const { getBuildDetailsRefreshIntervalMs } = await import(
  "../src/panels/buildDetails/BuildDetailsConfig"
);

function createConfig(value: unknown): vscode.WorkspaceConfiguration {
  return {
    get: <T>(_key: string, defaultValue?: T): T => (value === undefined ? defaultValue : value) as T
  } as vscode.WorkspaceConfiguration;
}

describe("getBuildDetailsRefreshIntervalMs", () => {
  it("uses the default interval when unset", () => {
    assert.equal(getBuildDetailsRefreshIntervalMs(createConfig(undefined)), 5000);
  });

  it("enforces the minimum interval", () => {
    assert.equal(getBuildDetailsRefreshIntervalMs(createConfig(0)), 2000);
  });

  it("caps the interval at the maximum setTimeout delay", () => {
    assert.equal(getBuildDetailsRefreshIntervalMs(createConfig(1e7)), 2_147_483_647);
    assert.equal(getBuildDetailsRefreshIntervalMs(createConfig(3_000_000)), 2_147_483_647);
  });
});
