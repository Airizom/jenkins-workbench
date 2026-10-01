import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

const appendLine = vi.fn();
const show = vi.fn();
const dispose = vi.fn();
const createOutputChannel = vi.fn(() => ({ appendLine, show, dispose }));

vi.doMock("vscode", () => ({ window: { createOutputChannel } }));

const { createLazyOutputChannel } = await import("../src/shared/LazyOutputChannel");

describe("createLazyOutputChannel", () => {
  it("creates the channel on first write and never after disposal", () => {
    const channel = createLazyOutputChannel("Jenkins Test");
    assert.equal(createOutputChannel.mock.calls.length, 0);

    channel.appendLine("first");
    channel.show(true);
    assert.deepEqual(createOutputChannel.mock.calls, [["Jenkins Test"]]);
    assert.deepEqual(appendLine.mock.calls, [["first"]]);
    assert.deepEqual(show.mock.calls, [[true]]);

    channel.dispose();
    channel.appendLine("ignored");
    assert.equal(dispose.mock.calls.length, 1);
    assert.equal(createOutputChannel.mock.calls.length, 1);
    assert.equal(appendLine.mock.calls.length, 1);
  });

  it("disposes cleanly when nothing was ever written", () => {
    createOutputChannel.mockClear();
    const channel = createLazyOutputChannel("Unused");
    channel.dispose();
    assert.equal(createOutputChannel.mock.calls.length, 0);
  });
});
