import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import {
  isSerializedEnvironmentState,
  resolveEnvironmentRef,
  validateEnvironmentScopedPanelState
} from "../src/panels/shared/webview/WebviewPanelState";

describe("isSerializedEnvironmentState", () => {
  it("accepts a non-empty environment id with a known scope", () => {
    assert.equal(isSerializedEnvironmentState({ environmentId: "env", scope: "global" }), true);
    assert.equal(isSerializedEnvironmentState({ environmentId: "env", scope: "workspace" }), true);
  });

  it("rejects missing, empty, or non-string environment ids and unknown scopes", () => {
    assert.equal(isSerializedEnvironmentState(undefined), false);
    assert.equal(isSerializedEnvironmentState("env"), false);
    assert.equal(isSerializedEnvironmentState({ scope: "global" }), false);
    assert.equal(isSerializedEnvironmentState({ environmentId: "", scope: "global" }), false);
    assert.equal(isSerializedEnvironmentState({ environmentId: 1, scope: "global" }), false);
    assert.equal(isSerializedEnvironmentState({ environmentId: "env", scope: "other" }), false);
  });
});

describe("validateEnvironmentScopedPanelState", () => {
  it("passes the record to the extra-field validator only for valid environment state", () => {
    const seen: Record<string, unknown>[] = [];
    const validate = (record: Record<string, unknown>) => {
      seen.push(record);
      return record.jobUrl === "job/demo/";
    };
    const state = { environmentId: "env", scope: "global", jobUrl: "job/demo/" };

    assert.equal(validateEnvironmentScopedPanelState(state, validate), true);
    assert.equal(
      validateEnvironmentScopedPanelState({ ...state, jobUrl: "other" }, validate),
      false
    );
    assert.equal(
      validateEnvironmentScopedPanelState({ ...state, environmentId: "" }, validate),
      false
    );
    assert.equal(seen.length, 2);
    assert.equal(seen[0], state);
  });
});

describe("resolveEnvironmentRef", () => {
  it("restores the current stored TLS policy without persisting it in panel state", async () => {
    let allowInsecureTls = true;
    const store = {
      getEnvironments: async () => [
        { id: "env", url: "https://jenkins.example/", allowInsecureTls }
      ]
    } as unknown as JenkinsEnvironmentStore;
    const state = { environmentId: "env", scope: "workspace" as const };

    assert.equal((await resolveEnvironmentRef(store, state))?.allowInsecureTls, true);
    allowInsecureTls = false;
    assert.equal((await resolveEnvironmentRef(store, state))?.allowInsecureTls, undefined);
    assert.deepEqual(state, { environmentId: "env", scope: "workspace" });
  });
});
