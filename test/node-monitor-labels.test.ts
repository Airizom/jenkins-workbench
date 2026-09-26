import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatMonitorLabel } from "../src/panels/nodeDetails/webview/components/nodeDetails/monitorLabels";

describe("formatMonitorLabel", () => {
  it("humanizes Jenkins node monitor class names", () => {
    assert.equal(formatMonitorLabel("hudson.node_monitors.DiskSpaceMonitor"), "Disk space");
    assert.equal(formatMonitorLabel("hudson.node_monitors.ResponseTimeMonitor"), "Response time");
    assert.equal(formatMonitorLabel("hudson.node_monitors.ArchitectureMonitor"), "Architecture");
  });

  it("keeps acronyms and handles nested class names", () => {
    assert.equal(formatMonitorLabel("com.example.JVMMemoryMonitor"), "JVM memory");
    assert.equal(formatMonitorLabel("com.example.Outer$ClockMonitor"), "Clock");
  });

  it("falls back to the raw key when nothing readable remains", () => {
    assert.equal(formatMonitorLabel("Monitor"), "Monitor");
    assert.equal(formatMonitorLabel(""), "");
  });
});
