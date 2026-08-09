import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsDiagnosticProfileBindingStore } from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";
import {
  removeJobMetadataOnDelete,
  updateJobMetadataOnRename
} from "../src/commands/job/JobMetadataCoordinator";

describe("JobMetadataCoordinator", () => {
  it("updates diagnostic bindings with other metadata on rename", async () => {
    const updateBindingUrl = vi.fn(async () => true);
    const updatePresetUrl = vi.fn(async () => true);
    const updatePinUrl = vi.fn(async () => true);
    const updateWatchUrl = vi.fn(async () => true);

    const result = await updateJobMetadataOnRename(
      {
        bindingStore: { updateBindingUrl } as unknown as JenkinsDiagnosticProfileBindingStore,
        presetStore: { updatePresetUrl } as unknown as JenkinsParameterPresetStore,
        pinStore: { updatePinUrl } as unknown as JenkinsPinStore,
        watchStore: { updateWatchUrl } as unknown as JenkinsWatchStore
      },
      {
        scope: "workspace",
        environmentId: "env-1",
        jobUrl: "https://jenkins.example/job/old/"
      },
      "https://jenkins.example/job/new/",
      "new"
    );

    assert.deepEqual(result.failures, []);
    assert.deepEqual(updateBindingUrl.mock.calls[0], [
      "workspace",
      "env-1",
      "https://jenkins.example/job/old/",
      "https://jenkins.example/job/new/"
    ]);
    assert.equal(updatePresetUrl.mock.calls.length, 1);
    assert.equal(updatePinUrl.mock.calls.length, 1);
    assert.equal(updateWatchUrl.mock.calls.length, 1);
  });

  it("removes diagnostic bindings with other metadata on delete and isolates failures", async () => {
    const bindingFailure = new Error("binding cleanup failed");
    const removeBindingsForJob = vi.fn(async () => {
      throw bindingFailure;
    });
    const removePresetsForJob = vi.fn(async () => undefined);
    const removePin = vi.fn(async () => true);
    const removeWatch = vi.fn(async () => true);

    const result = await removeJobMetadataOnDelete(
      {
        bindingStore: { removeBindingsForJob } as unknown as JenkinsDiagnosticProfileBindingStore,
        presetStore: { removePresetsForJob } as unknown as JenkinsParameterPresetStore,
        pinStore: { removePin } as unknown as JenkinsPinStore,
        watchStore: { removeWatch } as unknown as JenkinsWatchStore
      },
      {
        scope: "global",
        environmentId: "env-1",
        jobUrl: "https://jenkins.example/job/deleted/"
      }
    );

    assert.deepEqual(result.failures, [bindingFailure]);
    assert.deepEqual(removeBindingsForJob.mock.calls[0], [
      "global",
      "env-1",
      "https://jenkins.example/job/deleted/"
    ]);
    assert.equal(removePresetsForJob.mock.calls.length, 1);
    assert.equal(removePin.mock.calls.length, 1);
    assert.equal(removeWatch.mock.calls.length, 1);
  });
});
