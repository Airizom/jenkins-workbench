import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { JobParameter } from "../src/jenkins/JenkinsDataService";
import type { BuildParameterPromptOptions } from "../src/ui/buildParameterPrompts/BuildParameterPromptTypes";
import { isSensitiveParameter } from "../src/ui/buildParameterPrompts/ParameterSensitivity";
import { fetchRunBuildChoices } from "../src/ui/buildParameterPrompts/RunParameterLookup";

interface InputBoxOptions {
  readonly prompt?: string;
  readonly password?: boolean;
  readonly value?: string;
}

interface QuickPickItem {
  readonly label: string;
  readonly action?: string;
  readonly picked?: boolean;
}

const inputBoxCalls: InputBoxOptions[] = [];
const quickPickCalls: Array<readonly QuickPickItem[]> = [];
let quickPickActions: string[] = [];
let multiChoicePicks: QuickPickItem[] | undefined;
let inputBoxValue: string | undefined = "typed-secret";
let openedTextDocuments = 0;

const vscodeMock = {
  window: {
    showInputBox: async (options: InputBoxOptions) => {
      inputBoxCalls.push(options);
      return inputBoxValue;
    },
    showTextDocument: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async (items: readonly QuickPickItem[], options?: { canPickMany?: boolean }) => {
      quickPickCalls.push(items);
      if (options?.canPickMany) {
        return multiChoicePicks;
      }
      const selectedAction = quickPickActions.shift();
      return items.find((item) => item.action === selectedAction);
    },
    showOpenDialog: async () => undefined
  },
  workspace: {
    openTextDocument: async () => {
      openedTextDocuments += 1;
      return {
        getText: () => "plaintext"
      };
    }
  }
};

vi.doMock("vscode", () => vscodeMock);
const { promptParameterValues } = await import(
  "../src/ui/buildParameterPrompts/ParameterValuePrompts"
);
const { choosePreset } = await import("../src/ui/buildParameterPrompts/PresetSelectionPrompts");

function createOptions(
  parameters: BuildParameterPromptOptions["parameters"]
): BuildParameterPromptOptions {
  return {
    dataService: {},
    presetStore: {},
    environment: {
      scope: "workspace",
      environmentId: "env-1",
      url: "https://jenkins.example/"
    },
    jobUrl: "https://jenkins.example/job/demo/",
    jobLabel: "demo",
    parameters
  } as BuildParameterPromptOptions;
}

beforeEach(() => {
  inputBoxCalls.length = 0;
  quickPickCalls.length = 0;
  quickPickActions = [];
  multiChoicePicks = undefined;
  inputBoxValue = "typed-secret";
  openedTextDocuments = 0;
});

describe("promptParameterValues multi-choice parameters", () => {
  it.each([undefined, ","])(
    "sends an explicit empty value after clearing a default selection (delimiter: %s)",
    async (multiSelectDelimiter) => {
      multiChoicePicks = [];
      const prompted = await promptParameterValues(
        createOptions([
          {
            name: "TARGETS",
            kind: "multiChoice",
            choices: ["alpha", "beta"],
            defaultValue: "alpha",
            multiSelectDelimiter
          }
        ])
      );

      assert.deepEqual(prompted?.values.TARGETS, []);
      assert.deepEqual(prompted?.payload.fields, [{ name: "TARGETS", value: "" }]);
      assert.equal(quickPickCalls[0][0].picked, true);
    }
  );
});

describe("choosePreset quick picks", () => {
  const presets = [{ id: "preset-1", name: "Release", updatedAt: 1 }];

  it("relies on dismissal instead of presenting a cancel action", async () => {
    const options = createOptions([]);
    options.presetStore = {
      listPresets: async () => presets
    } as unknown as BuildParameterPromptOptions["presetStore"];

    const result = await choosePreset(options);

    assert.equal(result, undefined);
    assert.deepEqual(
      quickPickCalls[0].map((item) => item.label),
      ["Manual entry", "Use preset: Release", "Manage presets"]
    );
  });

  it("returns the selected preset as the sole preset identity", async () => {
    const preset = { ...presets[0], values: { BRANCH: "main" } };
    const options = createOptions([]);
    options.presetStore = {
      listPresets: async () => presets,
      getPreset: async () => preset
    } as unknown as BuildParameterPromptOptions["presetStore"];
    quickPickActions = ["preset"];

    const result = await choosePreset(options);

    assert.deepEqual(result, { preset });
  });

  it("relies on dismissal instead of presenting a back action when managing presets", async () => {
    const renamePreset = vi.fn();
    const deletePreset = vi.fn();
    const options = createOptions([]);
    options.presetStore = {
      listPresets: async () => presets,
      renamePreset,
      deletePreset
    } as unknown as BuildParameterPromptOptions["presetStore"];
    quickPickActions = ["manage"];

    const result = await choosePreset(options);

    assert.equal(result, undefined);
    assert.deepEqual(
      quickPickCalls[1].map((item) => item.label),
      ["Rename preset", "Delete preset"]
    );
    assert.equal(renamePreset.mock.calls.length, 0);
    assert.equal(deletePreset.mock.calls.length, 0);
  });
});

describe("promptParameterValues sensitive parameters", () => {
  it("classifies Jenkins sensitive parameter forms in one shared helper", () => {
    assert.equal(isSensitiveParameter({ name: "TOKEN", kind: "string", isSensitive: true }), true);
    assert.equal(isSensitiveParameter({ name: "PASSWORD", kind: "password" }), true);
    assert.equal(isSensitiveParameter({ name: "CREDENTIALS", kind: "credentials" }), true);
    assert.equal(isSensitiveParameter({ name: "PLAIN", kind: "string" } as JobParameter), false);
  });

  it("masks sensitive string parameters", async () => {
    const prompted = await promptParameterValues(
      createOptions([
        {
          name: "TOKEN",
          kind: "string",
          defaultValue: "default-secret",
          isSensitive: true
        }
      ])
    );

    assert.equal(inputBoxCalls.length, 1);
    assert.equal(inputBoxCalls[0].password, true);
    assert.equal(inputBoxCalls[0].value, "default-secret");
    assert.equal(openedTextDocuments, 0);
    assert.deepEqual(prompted?.payload.fields, [{ name: "TOKEN", value: "typed-secret" }]);
  });

  it("does not open sensitive text parameters in a plaintext editor", async () => {
    await promptParameterValues(
      createOptions([
        {
          name: "SECRET_TEXT",
          kind: "text",
          defaultValue: "line one\nline two",
          isSensitive: true
        }
      ])
    );

    assert.equal(openedTextDocuments, 0);
    assert.equal(inputBoxCalls.length, 1);
    assert.equal(inputBoxCalls[0].password, true);
    assert.equal(inputBoxCalls[0].value, "line one\nline two");
  });
});

describe("fetchRunBuildChoices run parameter lookup", () => {
  it("queries the canonical Jenkins job URL first for a simple project name", async () => {
    const requestedJobUrls: string[] = [];
    const options = createOptions([
      {
        name: "RUN_BUILD",
        kind: "run",
        runProjectName: "foo"
      }
    ]);
    options.dataService = {
      getBuildsForJob: async (
        _environment: BuildParameterPromptOptions["environment"],
        jobUrl: string
      ) => {
        requestedJobUrls.push(jobUrl);
        return [{ number: 42 }];
      }
    } as unknown as BuildParameterPromptOptions["dataService"];

    await fetchRunBuildChoices(options, options.parameters[0]);

    assert.deepEqual(requestedJobUrls, ["https://jenkins.example/job/foo/"]);
  });

  it("does not request external absolute runProjectName URLs", async () => {
    const requestedJobUrls: string[] = [];
    const options = createOptions([
      {
        name: "RUN_BUILD",
        kind: "run",
        runProjectName: "https://example.invalid/job/x/"
      }
    ]);
    options.dataService = {
      getBuildsForJob: async (
        _environment: BuildParameterPromptOptions["environment"],
        jobUrl: string
      ) => {
        requestedJobUrls.push(jobUrl);
        return [];
      }
    } as unknown as BuildParameterPromptOptions["dataService"];

    await fetchRunBuildChoices(options, options.parameters[0]);

    assert.deepEqual(requestedJobUrls, []);
  });

  it("does not offer current-job builds when an explicit target has no builds", async () => {
    const requestedJobUrls: string[] = [];
    const options = createOptions([{ name: "RUN_BUILD", kind: "run", runProjectName: "foo" }]);
    options.dataService = {
      getBuildsForJob: async (
        _environment: BuildParameterPromptOptions["environment"],
        jobUrl: string
      ) => {
        requestedJobUrls.push(jobUrl);
        return jobUrl === options.jobUrl ? [{ number: 42 }] : [];
      }
    } as unknown as BuildParameterPromptOptions["dataService"];

    const choices = await fetchRunBuildChoices(options, options.parameters[0]);

    assert.deepEqual(choices, []);
    assert.deepEqual(requestedJobUrls, ["https://jenkins.example/job/foo/"]);
  });

  it("uses the current job when no run target is configured", async () => {
    const requestedJobUrls: string[] = [];
    const options = createOptions([{ name: "RUN_BUILD", kind: "run" }]);
    options.dataService = {
      getBuildsForJob: async (
        _environment: BuildParameterPromptOptions["environment"],
        jobUrl: string
      ) => {
        requestedJobUrls.push(jobUrl);
        return [{ number: 42 }];
      }
    } as unknown as BuildParameterPromptOptions["dataService"];

    const choices = await fetchRunBuildChoices(options, options.parameters[0]);

    assert.equal(choices[0]?.number, 42);
    assert.deepEqual(requestedJobUrls, [options.jobUrl]);
  });
});
