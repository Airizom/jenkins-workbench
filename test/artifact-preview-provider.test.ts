import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exactModuleMock, withModuleMocks } from "./helpers/moduleMock";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

class TestUri {
  constructor(readonly path: string) {}

  static from(value: { path: string }): TestUri {
    return new TestUri(value.path);
  }
}

const vscodeMock = {
  ...createEventEmitterVscodeMock(),
  Uri: TestUri
};

const { ArtifactPreviewCacheLimitError, ArtifactPreviewProvider } = withModuleMocks(
  [exactModuleMock("vscode", vscodeMock)],
  () =>
    require("../src/ui/ArtifactPreviewProvider") as {
      ArtifactPreviewCacheLimitError: typeof import(
        "../src/ui/ArtifactPreviewProvider"
      ).ArtifactPreviewCacheLimitError;
      ArtifactPreviewProvider: typeof import(
        "../src/ui/ArtifactPreviewProvider"
      ).ArtifactPreviewProvider;
    }
);

function getCacheState(provider: unknown): { totalBytes: number; entries: Map<string, unknown> } {
  return provider as { totalBytes: number; entries: Map<string, unknown> };
}

describe("ArtifactPreviewProvider", () => {
  it("rejects a preview larger than the configured byte limit", () => {
    const provider = new ArtifactPreviewProvider({ maxTotalBytes: 4 });

    assert.throws(
      () => provider.registerArtifact(new Uint8Array(5), "artifact.bin"),
      ArtifactPreviewCacheLimitError
    );

    const state = getCacheState(provider);
    assert.equal(state.totalBytes, 0);
    assert.equal(state.entries.size, 0);
    provider.dispose();
  });

  it("does not exceed the byte limit when active previews cannot be evicted", () => {
    const provider = new ArtifactPreviewProvider({ maxTotalBytes: 8 });
    const activeUri = provider.registerArtifact(new Uint8Array(5), "active.bin");
    provider.markInUse(activeUri);

    assert.throws(
      () => provider.registerArtifact(new Uint8Array(4), "next.bin"),
      ArtifactPreviewCacheLimitError
    );

    const state = getCacheState(provider);
    assert.equal(state.totalBytes, 5);
    assert.equal(state.entries.size, 1);
    provider.dispose();
  });
});
