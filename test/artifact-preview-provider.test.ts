import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
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

vi.doMock("vscode", () => vscodeMock);
const { ArtifactPreviewCacheLimitError, ArtifactPreviewProvider } = await import(
  "../src/ui/ArtifactPreviewProvider"
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

  it("evicts unused previews to make room for a new preview", () => {
    const provider = new ArtifactPreviewProvider({ maxTotalBytes: 10 });
    const firstUri = provider.registerArtifact(new Uint8Array(6), "first.bin");

    const secondUri = provider.registerArtifact(new Uint8Array(5), "second.bin");

    const state = getCacheState(provider);
    assert.equal(state.totalBytes, 5);
    assert.equal(state.entries.size, 1);
    assert.equal(state.entries.has(firstUri.path.split("/")[1]), false);
    assert.equal(state.entries.has(secondUri.path.split("/")[1]), true);
    provider.dispose();
  });

  it("keeps unused previews when active previews leave insufficient capacity", () => {
    const provider = new ArtifactPreviewProvider({ maxTotalBytes: 10 });
    const activeUri = provider.registerArtifact(new Uint8Array(6), "active.bin");
    provider.markInUse(activeUri);
    provider.registerArtifact(new Uint8Array(2), "idle.bin");

    assert.throws(
      () => provider.registerArtifact(new Uint8Array(5), "next.bin"),
      ArtifactPreviewCacheLimitError
    );

    const state = getCacheState(provider);
    assert.equal(state.totalBytes, 8);
    assert.equal(state.entries.size, 2);
    provider.dispose();
  });
});
