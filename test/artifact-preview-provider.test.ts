import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

class TestUri {
  constructor(readonly path: string) {}

  static from(value: { path: string }): TestUri {
    return new TestUri(value.path);
  }
}

const vscodeMock = {
  ...createEventEmitterVscodeMock(),
  FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
  FileType: { File: 1, Directory: 2 },
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
      (error: unknown) =>
        error instanceof ArtifactPreviewCacheLimitError && /exceeding/.test(error.message)
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
      (error: unknown) =>
        error instanceof ArtifactPreviewCacheLimitError && /only 3 bytes remain/.test(error.message)
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

  describe("updateArtifact", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function trackChanges(provider: InstanceType<typeof ArtifactPreviewProvider>) {
      const events: Array<Array<{ type: number; uri: unknown }>> = [];
      provider.onDidChangeFile((event) => {
        events.push(event as unknown as Array<{ type: number; uri: unknown }>);
      });
      return events;
    }

    it("replaces the bytes, adjusts the byte total, and fires a change event", () => {
      vi.useFakeTimers({ now: 1_000 });
      const provider = new ArtifactPreviewProvider({ maxTotalBytes: 100 });
      const uri = provider.registerArtifact(new Uint8Array(4), "build.log");
      const events = trackChanges(provider);
      const initialMtime = provider.stat(uri).mtime;

      assert.equal(provider.updateArtifact(uri, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), true);
      assert.equal(getCacheState(provider).totalBytes, 9);
      assert.deepEqual(provider.readFile(uri), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      const grownStat = provider.stat(uri);
      assert.equal(grownStat.size, 9);
      assert.ok(grownStat.mtime > initialMtime);

      assert.equal(provider.updateArtifact(uri, new Uint8Array([7, 8])), true);
      assert.equal(getCacheState(provider).totalBytes, 2);
      const shrunkStat = provider.stat(uri);
      assert.equal(shrunkStat.size, 2);
      assert.ok(shrunkStat.mtime > grownStat.mtime);

      assert.deepEqual(events, [[{ type: 1, uri }], [{ type: 1, uri }]]);
      provider.dispose();
    });

    it("returns false for an unknown preview", () => {
      const provider = new ArtifactPreviewProvider();
      const events = trackChanges(provider);

      assert.equal(
        provider.updateArtifact(
          TestUri.from({ path: "/missing/build.log" }) as never,
          new Uint8Array(1)
        ),
        false
      );
      assert.equal(events.length, 0);
      provider.dispose();
    });

    it("leaves the entry unchanged when the new bytes exceed the cache limit", () => {
      const provider = new ArtifactPreviewProvider({ maxTotalBytes: 10 });
      const otherUri = provider.registerArtifact(new Uint8Array(4), "other.bin");
      provider.markInUse(otherUri);
      const uri = provider.registerArtifact(new Uint8Array([1, 2]), "build.log");
      provider.markInUse(uri);
      const events = trackChanges(provider);
      const before = provider.stat(uri);

      assert.equal(provider.updateArtifact(uri, new Uint8Array(7)), false);

      const after = provider.stat(uri);
      assert.equal(after.size, 2);
      assert.equal(after.mtime, before.mtime);
      assert.deepEqual(provider.readFile(uri), new Uint8Array([1, 2]));
      assert.equal(getCacheState(provider).totalBytes, 6);
      assert.equal(getCacheState(provider).entries.size, 2);
      assert.equal(events.length, 0);
      provider.dispose();
    });

    it("evicts unused previews to make room for the update", () => {
      const provider = new ArtifactPreviewProvider({ maxTotalBytes: 10 });
      provider.registerArtifact(new Uint8Array(4), "idle.bin");
      const uri = provider.registerArtifact(new Uint8Array(2), "build.log");
      provider.markInUse(uri);

      assert.equal(provider.updateArtifact(uri, new Uint8Array(9)), true);

      const state = getCacheState(provider);
      assert.equal(state.totalBytes, 9);
      assert.equal(state.entries.size, 1);
      assert.equal(provider.stat(uri).size, 9);
      provider.dispose();
    });
  });
});
