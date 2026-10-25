import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { NodeAgentLogResult } from "../src/jenkins/NodeManagement";
import type { NodeAgentLogState } from "../src/panels/nodeDetails/shared/NodeAgentLogContracts";
import {
  boundLogText,
  NODE_AGENT_LOG_BUFFER_BYTES,
  NodeAgentLogController
} from "../src/services/NodeAgentLogController";

afterEach(() => vi.useRealTimers());

const logResult = (
  text: string,
  nextStart = 10,
  reset = false,
  truncated = false
): NodeAgentLogResult => ({
  text,
  nextStart,
  reset,
  truncated
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setup() {
  vi.useFakeTimers();
  const states: NodeAgentLogState[] = [];
  const controller = new NodeAgentLogController((state) => states.push(state));
  const reader = vi.fn(async (_options: { start?: number; signal: AbortSignal }) =>
    logResult("first\n")
  );
  controller.reset(reader);
  const state = () => {
    const current = states.at(-1);
    assert.ok(current);
    return current;
  };
  return { controller, reader, states, state };
}

describe("NodeAgentLogController", () => {
  it("loads only the visible log tab, then follows from its returned byte offset", async () => {
    const { controller, reader, state } = setup();
    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(9_000);
    assert.equal(reader.mock.calls.length, 0);
    controller.setActive(true);
    await settle();
    assert.equal(reader.mock.calls[0][0].start, undefined);
    assert.equal(state().text, "first\n");
    reader.mockResolvedValue(logResult("next\n", 20));
    await vi.advanceTimersByTimeAsync(3_000);
    assert.equal(reader.mock.calls.length, 2);
    assert.equal(reader.mock.calls[1][0].start, 10);
    assert.equal(state().text, "first\nnext\n");
    controller.dispose();
  });

  it.each(["hidden", "inactive", "paused", "disposed"])(
    "aborts in-flight reads and ignores their late response when %s",
    async (reason) => {
      const { controller, reader, state } = setup();
      let resolve!: (value: ReturnType<typeof logResult>) => void;
      reader.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      controller.setVisible(true);
      controller.setActive(true);
      const signal = reader.mock.calls[0][0].signal;
      if (reason === "hidden") controller.setVisible(false);
      if (reason === "inactive") controller.setActive(false);
      if (reason === "paused") controller.setFollowing(false);
      if (reason === "disposed") controller.dispose();
      assert.equal(signal.aborted, true);
      resolve(logResult("late output"));
      await settle();
      await vi.advanceTimersByTimeAsync(9_000);
      assert.equal(state().text, "");
      assert.equal(reader.mock.calls.length, 1);
    }
  );

  it("resumes a hidden follow session without losing the displayed buffer", async () => {
    const { controller, reader, state } = setup();
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    controller.setVisible(false);
    reader.mockResolvedValue(logResult("resumed", 17));
    await vi.advanceTimersByTimeAsync(3_000);
    assert.equal(reader.mock.calls.length, 1);
    controller.setVisible(true);
    await settle();
    assert.equal(reader.mock.calls[1][0].start, 10);
    assert.equal(state().text, "first\nresumed");
    controller.dispose();
  });

  it("keeps a failure visible when the webview echoes its paused preference", async () => {
    const { controller, reader, state } = setup();
    reader.mockRejectedValue(new Error("permission denied"));
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    controller.setFollowing(false);
    controller.setActive(true);
    await settle();
    assert.equal(reader.mock.calls.length, 1);
    assert.match(state().error ?? "", /permission denied/);
    controller.dispose();
  });

  it("reports catch-up until the server cursor reaches current output", async () => {
    const { controller, reader, state } = setup();
    reader.mockResolvedValue({ ...logResult("older batch", 10), catchingUp: true });
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    assert.equal(state().catchingUp, true);
    reader.mockResolvedValue(logResult("latest", 20));
    await vi.advanceTimersByTimeAsync(3_000);
    assert.equal(state().catchingUp, false);
    controller.dispose();
  });

  it("replaces output after a remote reset and records truncation", async () => {
    const { controller, reader, state } = setup();
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    reader.mockResolvedValue(logResult("new log", 7, true, true));
    await vi.advanceTimersByTimeAsync(3_000);
    assert.equal(state().text, "new log");
    assert.equal(state().omitted, true);
    controller.dispose();
  });

  it("refreshes a paused log with a new tail without restarting follow", async () => {
    const { controller, reader, state } = setup();
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    controller.setFollowing(false);
    reader.mockResolvedValue(logResult("fresh tail", 35));
    controller.refresh();
    await settle();
    assert.equal(reader.mock.calls[1][0].start, undefined);
    assert.equal(state().text, "fresh tail");
    assert.equal(state().following, false);
    await vi.advanceTimersByTimeAsync(9_000);
    assert.equal(reader.mock.calls.length, 2);
    controller.dispose();
  });

  it("pauses after a failure, retaining output and allowing explicit retry", async () => {
    const { controller, reader, state } = setup();
    controller.setVisible(true);
    controller.setActive(true);
    await settle();
    reader.mockRejectedValue(new Error("permission denied"));
    await vi.advanceTimersByTimeAsync(3_000);
    assert.equal(state().following, false);
    assert.match(state().error ?? "", /permission denied/);
    assert.equal(state().text, "first\n");
    await vi.advanceTimersByTimeAsync(9_000);
    assert.equal(reader.mock.calls.length, 2);
    reader.mockResolvedValue(logResult("retry"));
    controller.refresh();
    await settle();
    assert.equal(state().error, undefined);
    assert.equal(state().text, "retry");
    controller.dispose();
  });

  it("does not carry a previous target's late response or byte offset into a new target", async () => {
    const { controller, reader, state } = setup();
    let resolve!: (value: ReturnType<typeof logResult>) => void;
    reader.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    controller.setVisible(true);
    controller.setActive(true);
    const nextReader = vi.fn(async (_options: { start?: number; signal: AbortSignal }) =>
      logResult("new target", 50)
    );
    controller.reset(nextReader);
    controller.setActive(true);
    await settle();
    resolve(logResult("old target"));
    await settle();
    assert.equal(reader.mock.calls[0][0].signal.aborted, true);
    assert.equal(nextReader.mock.calls[0][0].start, undefined);
    assert.equal(state().text, "new target");
    controller.dispose();
  });

  it("does not overlap slow reads or restart on a duplicate tab selection", async () => {
    const { controller, reader } = setup();
    let resolve!: (value: ReturnType<typeof logResult>) => void;
    reader.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    controller.setVisible(true);
    controller.setActive(true);
    controller.setActive(true);
    await vi.advanceTimersByTimeAsync(12_000);
    assert.equal(reader.mock.calls.length, 1);
    resolve(logResult("done"));
    await settle();
    controller.dispose();
  });
});

describe("boundLogText", () => {
  it("retains a bounded tail with complete multibyte characters", () => {
    const result = boundLogText("😀".repeat(NODE_AGENT_LOG_BUFFER_BYTES));
    assert.equal(result.omitted, true);
    assert.ok(Buffer.byteLength(result.text) <= NODE_AGENT_LOG_BUFFER_BYTES);
    assert.ok(!result.text.includes("\uFFFD"));
    assert.equal(boundLogText("normal").text, "normal");
    assert.equal(boundLogText("normal").omitted, false);
  });
});
