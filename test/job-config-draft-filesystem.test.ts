import assert from "node:assert/strict";
import { it, vi } from "vitest";
import * as vscodeStub from "./helpers/vscodeStub";

vi.doMock("vscode", () => ({
  ...vscodeStub,
  Uri: {
    from: ({ scheme, path }: { scheme: string; path: string }) => ({ scheme, path })
  }
}));

const { JobConfigDraftFilesystem } = await import("../src/services/JobConfigDraftFilesystem");

it("keeps drafts with the same label and timestamp separate", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(123456789);
  try {
    const filesystem = new JobConfigDraftFilesystem();
    const first = filesystem.createDraft("example", "first content");
    const second = filesystem.createDraft("example", "second content");

    assert.notEqual(first.path, second.path);
    assert.equal(Buffer.from(filesystem.readFile(first)).toString("utf8"), "first content");
    assert.equal(Buffer.from(filesystem.readFile(second)).toString("utf8"), "second content");
  } finally {
    now.mockRestore();
  }
});
