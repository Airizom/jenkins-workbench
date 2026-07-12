import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

const values: Record<string, unknown> = {};

vi.doMock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => values[key],
      inspect: () => undefined
    })
  }
}));

const { WorkspaceTestSourceFileMatchConfig } = await import(
  "../src/services/TestSourceFileMatchConfig"
);

describe("WorkspaceTestSourceFileMatchConfig", () => {
  it("normalizes legacy fractional and excessive result limits", () => {
    const config = new WorkspaceTestSourceFileMatchConfig();

    values.maxResultsPerPattern = 3.8;
    assert.equal(config.getOptions().maxResultsPerPattern, 3);

    values.maxResultsPerPattern = 100_000;
    assert.equal(config.getOptions().maxResultsPerPattern, 100);
  });
});
