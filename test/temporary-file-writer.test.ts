import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it, vi } from "vitest";
import { writeViaTemporaryFile } from "../src/services/TemporaryFileWriter";

const TARGET_PATH = path.join("/workspace", "out", "report.log");

describe("writeViaTemporaryFile", () => {
  it("writes a hidden sibling temp file and renames it into place", async () => {
    const write = vi.fn(async () => "done");
    const rename = vi.fn(async () => {});
    const remove = vi.fn(async () => {});

    const result = await writeViaTemporaryFile(TARGET_PATH, { write, rename, delete: remove });

    assert.equal(result, "done");
    const [temporaryPath] = write.mock.calls[0] as unknown as [string];
    assert.equal(path.dirname(temporaryPath), path.dirname(TARGET_PATH));
    assert.match(path.basename(temporaryPath), /^\.report\.log\.[0-9a-f-]{36}\.tmp$/);
    assert.deepEqual(rename.mock.calls, [[temporaryPath]]);
    assert.equal(remove.mock.calls.length, 0);
  });

  it("deletes the temp file and rethrows when rename fails", async () => {
    const error = new Error("rename failed");
    const write = vi.fn(async () => {});
    const remove = vi.fn(async () => {});

    await assert.rejects(
      writeViaTemporaryFile(TARGET_PATH, {
        write,
        rename: async () => {
          throw error;
        },
        delete: remove
      }),
      error
    );

    assert.deepEqual(remove.mock.calls, write.mock.calls);
  });

  it("preserves the write error when cleanup also fails", async () => {
    const error = new Error("write failed");

    await assert.rejects(
      writeViaTemporaryFile(TARGET_PATH, {
        write: async () => {
          throw error;
        },
        rename: async () => {},
        delete: async () => {
          throw new Error("unlink failed");
        }
      }),
      error
    );
  });
});
