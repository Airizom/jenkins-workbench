import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const originalLoad = Module._load;
Module._load = function loadWithVscodeStub(request, parent, isMain) {
  if (request === "vscode") {
    return {
      workspace: {
        getConfiguration: () => ({})
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { getArtifactMaxDownloadBytes } = await import("../out/extension/ExtensionConfig.js");
Module._load = originalLoad;

function createConfig(value) {
  return {
    get: () => value
  };
}

test("artifact max download size treats zero as unlimited", () => {
  assert.equal(getArtifactMaxDownloadBytes(createConfig(0)), undefined);
});

test("artifact max download size preserves fractional megabytes", () => {
  assert.equal(getArtifactMaxDownloadBytes(createConfig(0.5)), 524288);
});

test("artifact max download size floors after converting to bytes", () => {
  assert.equal(getArtifactMaxDownloadBytes(createConfig(100.5)), 105381888);
});
