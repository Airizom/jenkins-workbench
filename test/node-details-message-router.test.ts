import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { routeNodeDetailsMessage } from "../src/panels/nodeDetails/NodeDetailsMessageRouter";

function createHandlers() {
  return {
    refresh: vi.fn(async () => {}),
    loadAdvanced: vi.fn(async () => {}),
    performAction: vi.fn(async (_action: string) => {}),
    openExternal: vi.fn(async (_url: string) => {}),
    copyJson: vi.fn(async (_content: string) => {})
  };
}

describe("routeNodeDetailsMessage", () => {
  it.each([
    { message: { type: "refreshNodeDetails" }, handler: "refresh", args: [] },
    { message: { type: "loadAdvancedNodeDetails" }, handler: "loadAdvanced", args: [] },
    { message: { type: "takeNodeOffline" }, handler: "performAction", args: ["takeNodeOffline"] },
    { message: { type: "bringNodeOnline" }, handler: "performAction", args: ["bringNodeOnline"] },
    { message: { type: "launchNodeAgent" }, handler: "performAction", args: ["launchNodeAgent"] },
    {
      message: { type: "openExternal", url: "https://jenkins.example/" },
      handler: "openExternal",
      args: ["https://jenkins.example/"]
    },
    { message: { type: "copyNodeJson", content: "{}" }, handler: "copyJson", args: ["{}"] }
  ] as const)("dispatches $message.type once", ({ message, handler, args }) => {
    const handlers = createHandlers();
    routeNodeDetailsMessage(message, handlers);
    assert.deepEqual(handlers[handler].mock.calls, [args]);
    assert.equal(
      Object.values(handlers).reduce((count, fn) => count + fn.mock.calls.length, 0),
      1
    );
  });

  it.each([
    null,
    {},
    { type: "unknown" },
    { type: "openExternal", url: 1 },
    { type: "copyNodeJson" }
  ])("ignores malformed and unknown messages: %o", (message) => {
    const handlers = createHandlers();
    routeNodeDetailsMessage(message, handlers);
    assert.equal(
      Object.values(handlers).reduce((count, fn) => count + fn.mock.calls.length, 0),
      0
    );
  });
});
