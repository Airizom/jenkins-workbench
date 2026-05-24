import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

const calls = {
  errors: [],
  infos: [],
  inputs: [],
  warnings: []
};

const vscodeStub = {
  window: {
    showErrorMessage: (message) => {
      calls.errors.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message) => {
      calls.infos.push(message);
      return Promise.resolve(undefined);
    },
    showInputBox: () => Promise.resolve(calls.inputs.shift()),
    showWarningMessage: (message, _options, actionLabel) => {
      calls.warnings.push(message);
      return Promise.resolve(actionLabel);
    }
  }
};

function formatActionError(error) {
  return error instanceof Error ? error.message : "Unexpected error.";
}

const commandUtilsStub = {
  formatActionError,
  getTreeItemLabel: (item) => item.label ?? "item",
  requireSelection: (item) => item,
  withActionErrorMessage: async (messagePrefix, action) => {
    try {
      await action();
    } catch (error) {
      void vscodeStub.window.showErrorMessage(`${messagePrefix}: ${formatActionError(error)}`);
    }
  }
};

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  if (request === "../CommandUtils") {
    return commandUtilsStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { deleteJob, renameJob } = await import("../out/commands/job/JobActionHandlers.js");
Module._load = originalLoad;

function resetCalls(...inputs) {
  calls.errors = [];
  calls.infos = [];
  calls.inputs = [...inputs];
  calls.warnings = [];
}

function createItem() {
  return {
    label: "old-job",
    environment: {
      environmentId: "env-1",
      scope: "global",
      url: "https://jenkins.example/"
    },
    jobUrl: "job/old-job/"
  };
}

function createDeps(overrides = {}) {
  const refreshes = [];
  return {
    deps: {
      dataService: {
        deleteJob: async () => undefined,
        renameJob: async () => ({ newUrl: "job/new-job/" }),
        ...overrides.dataService
      },
      presetStore: {
        removePresetsForJob: async () => undefined,
        updatePresetUrl: async () => true,
        ...overrides.presetStore
      },
      pinStore: {
        removePin: async () => true,
        updatePinUrl: async () => true,
        ...overrides.pinStore
      },
      watchStore: {
        removeWatch: async () => true,
        updateWatchUrl: async () => true,
        ...overrides.watchStore
      },
      refreshHost: {
        fullEnvironmentRefresh: (refresh) => {
          refreshes.push(refresh);
        }
      }
    },
    refreshes
  };
}

test("renameJob refreshes and warns when local metadata update fails after Jenkins rename", async () => {
  resetCalls("new-job");
  const { deps, refreshes } = createDeps({
    presetStore: {
      updatePresetUrl: async () => {
        throw new Error("preset update failed");
      }
    }
  });

  await renameJob(deps, createItem());

  assert.deepEqual(refreshes, [{ environmentId: "env-1" }]);
  assert.deepEqual(calls.errors, []);
  assert.equal(calls.infos.length, 0);
  assert.ok(
    calls.warnings.some((message) =>
      message.includes(
        'Renamed "old-job" to "new-job", but some local Jenkins metadata could not be updated: preset update failed'
      )
    )
  );
});

test("deleteJob refreshes and warns when local metadata removal fails after Jenkins delete", async () => {
  resetCalls("old-job");
  const { deps, refreshes } = createDeps({
    watchStore: {
      removeWatch: async () => {
        throw new Error("watch removal failed");
      }
    }
  });

  await deleteJob(deps, createItem());

  assert.deepEqual(refreshes, [{ environmentId: "env-1" }]);
  assert.deepEqual(calls.errors, []);
  assert.equal(calls.infos.length, 0);
  assert.ok(
    calls.warnings.some((message) =>
      message.includes(
        'Deleted "old-job", but some local Jenkins metadata could not be removed: watch removal failed'
      )
    )
  );
});
