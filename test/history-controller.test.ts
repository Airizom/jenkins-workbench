import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  HistoryController,
  type HistoryDependencies
} from "../src/panels/jobHistory/HistoryController";
import type { HistoryViewModel } from "../src/panels/jobHistory/shared/HistoryContracts";

const environment = {
  environmentId: "e",
  scope: "workspace" as const,
  url: "https://jenkins.test/"
};
const window = {
  builds: [
    {
      build: { number: 3, url: "https://jenkins.test/job/a/3/", result: "FAILURE" },
      report: { status: "available", cases: [] }
    }
  ],
  truncated: false
};
function harness() {
  const messages = new vscode.EventEmitter<unknown>();
  const visibility = new vscode.EventEmitter<void>();
  const environmentChange = new vscode.EventEmitter<void>();
  const posted: HistoryViewModel[] = [];
  const panel = {
    visible: true,
    webview: {
      onDidReceiveMessage: messages.event,
      postMessage: (model: HistoryViewModel) => {
        posted.push(structuredClone(model));
        return Promise.resolve(true);
      }
    },
    onDidChangeViewState: visibility.event
  };
  const load = vi.fn().mockResolvedValue(window);
  const openBuild = vi.fn();
  const compare = vi.fn();
  const dependencies = {
    history: { guard: (request: unknown) => request, load },
    baseline: { resolve: vi.fn().mockResolvedValue({ status: "unavailable" }) },
    environments: {
      onDidChange: environmentChange.event,
      getEnvironments: async () => [{ id: "e", url: environment.url }]
    },
    openBuild,
    compare
  } as unknown as HistoryDependencies;
  const controller = new HistoryController(panel as unknown as vscode.WebviewPanel, dependencies);
  return {
    controller,
    messages,
    visibility,
    environmentChange,
    panel,
    load,
    openBuild,
    compare,
    posted,
    latest: () => posted[posted.length - 1]
  };
}
describe("history panel coordination", () => {
  it("sends bounded presentation data without full reports for a large suite", async () => {
    const h = harness();
    const cases = Array.from({ length: 5000 }, (_, index) => ({
      key: `t${index}`,
      name: `t${index}`,
      outcome: "failed",
      age: 2
    }));
    const builds = [3, 2].map((number) => ({
      build: { number, url: `https://jenkins.test/job/a/${number}/`, result: "FAILURE" },
      report: { status: "available", cases }
    }));
    h.load.mockResolvedValue({ builds, truncated: false });
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().evidence.t4999?.kind).toBe("continuing"));
    expect(h.latest().builds[0].report).not.toHaveProperty("cases");
    expect(h.latest().tests).toHaveLength(5000);
    h.controller.dispose();
  });
  it("resumes explicit analysis of a non-failing build after hiding", async () => {
    const h = harness();
    h.controller.setContext(environment, "https://jenkins.test/job/a/", undefined, false);
    h.messages.fire({
      type: "historyAction",
      revision: h.latest().revision,
      action: "window",
      value: 10
    });
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    h.panel.visible = false;
    h.visibility.fire();
    h.panel.visible = true;
    h.visibility.fire();
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    h.visibility.fire();
    expect(h.load).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });
  it("rejects unknown build ids and actions from stale revisions", async () => {
    const h = harness();
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    h.messages.fire({
      type: "historyAction",
      revision: h.latest().revision,
      action: "openBuild",
      value: 999
    });
    h.messages.fire({ type: "historyAction", revision: -1, action: "openBuild", value: 3 });
    expect(h.openBuild).not.toHaveBeenCalled();
    h.messages.fire({
      type: "historyAction",
      revision: h.latest().revision,
      action: "openBuild",
      value: 3
    });
    expect(h.openBuild).toHaveBeenCalledWith(environment, "https://jenkins.test/job/a/3/");
    h.controller.dispose();
  });
  it("does not abandon a window load when selection arrives mid-refresh", async () => {
    const h = harness();
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    let resolve!: (value: typeof window) => void;
    h.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    h.messages.fire({ type: "historyAction", revision: h.latest().revision, action: "refresh" });
    h.messages.fire({
      type: "historyAction",
      revision: h.latest().revision,
      action: "selectBuild",
      value: 3
    });
    resolve(window);
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    h.controller.dispose();
  });
  it("rebinds an existing environment instead of leaving a blank unrefreshable panel", async () => {
    const h = harness();
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    h.environmentChange.fire();
    await vi.waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    expect(h.latest().jobUrl).toBe("https://jenkins.test/job/a/");
    h.controller.dispose();
  });
  it("does not schedule automatic history for hidden panels or non-failing builds", () => {
    const h = harness();
    h.panel.visible = false;
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    expect(h.load).not.toHaveBeenCalled();
    h.panel.visible = true;
    h.controller.setContext(environment, "https://jenkins.test/job/a/", undefined, false);
    expect(h.load).not.toHaveBeenCalled();
    h.controller.dispose();
  });
  it("surfaces a paused state when hidden mid-load and resumes on visibility", async () => {
    const h = harness();
    let resolve!: (value: typeof window) => void;
    h.load.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    expect(h.latest().status).toBe("loading");
    h.panel.visible = false;
    h.visibility.fire();
    expect(h.latest()).toMatchObject({ status: "paused", pausedReason: "hidden" });
    resolve(window);
    await Promise.resolve();
    expect(h.latest().status).toBe("paused");
    h.panel.visible = true;
    h.visibility.fire();
    await vi.waitFor(() => expect(h.latest().status).toBe("available"));
    expect(h.latest().pausedReason).toBeUndefined();
    h.controller.dispose();
  });
  it("always compares the older build as baseline, whichever row is clicked", async () => {
    const h = harness();
    const builds = [5, 4, 3].map((number) => ({
      build: { number, url: `https://jenkins.test/job/a/${number}/`, result: "FAILURE" },
      report: { status: "available", cases: [] }
    }));
    h.load.mockResolvedValue({ builds, truncated: false });
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().selectedBuild).toBe(5));
    await vi.waitFor(() => expect(h.latest().baseline).toBeDefined());
    const send = (action: string, value: number) =>
      h.messages.fire({ type: "historyAction", revision: h.latest().revision, action, value });
    send("compare", 3);
    await vi.waitFor(() => expect(h.compare).toHaveBeenCalledTimes(1));
    expect(h.compare).toHaveBeenLastCalledWith(
      environment,
      "https://jenkins.test/job/a/3/",
      "https://jenkins.test/job/a/5/"
    );
    send("selectBuild", 3);
    await vi.waitFor(() => expect(h.latest().selectedBuild).toBe(3));
    await vi.waitFor(() => expect(h.latest().baseline).toBeDefined());
    send("compare", 4);
    await vi.waitFor(() => expect(h.compare).toHaveBeenCalledTimes(2));
    expect(h.compare).toHaveBeenLastCalledWith(
      environment,
      "https://jenkins.test/job/a/3/",
      "https://jenkins.test/job/a/4/"
    );
    h.controller.dispose();
  });
  it("reports load failures without a doubled error prefix", async () => {
    const h = harness();
    h.load.mockRejectedValue(new Error("Jenkins responded with 503"));
    h.controller.setContext(environment, "https://jenkins.test/job/a/");
    await vi.waitFor(() => expect(h.latest().status).toBe("error"));
    expect(h.latest().message).toBe("Jenkins responded with 503");
    h.controller.dispose();
  });
  it("marks history for a running anchor build as paused until it completes", () => {
    const h = harness();
    h.controller.setContext(environment, "https://jenkins.test/job/a/", {
      number: 4,
      url: "https://jenkins.test/job/a/4/",
      building: true
    });
    expect(h.load).not.toHaveBeenCalled();
    expect(h.latest()).toMatchObject({ status: "paused", pausedReason: "building" });
    h.controller.dispose();
  });
});
