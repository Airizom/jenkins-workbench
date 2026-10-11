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
  readonly mode?: string;
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
      return items.find((item) => (item.action ?? item.mode) === selectedAction);
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
  describe.each([
    { delimiter: " ", serializedValue: "red blue" },
    { delimiter: " | ", serializedValue: "red | blue" }
  ])("with delimiter '$delimiter'", ({ delimiter, serializedValue }) => {
    it.each([false, true])(
      "preserves the delimiter in defaults and payloads (use preset: %s)",
      async (usePreset) => {
        multiChoicePicks = [{ label: "red" }, { label: "blue" }];
        const prompted = await promptParameterValues(
          createOptions([
            {
              name: "COLORS",
              kind: "multiChoice",
              choices: ["red", "blue", "green"],
              defaultValue: usePreset ? "green" : serializedValue,
              multiSelectDelimiter: delimiter
            }
          ]),
          usePreset ? { COLORS: serializedValue } : undefined
        );

        assert.deepEqual(quickPickCalls[0], [
          { label: "red", picked: true },
          { label: "blue", picked: true },
          { label: "green", picked: false }
        ]);
        assert.deepEqual(prompted?.payload.fields, [{ name: "COLORS", value: serializedValue }]);
      }
    );
  });

  it.each([undefined, ""])(
    "uses comma-separated defaults and repeated fields for an absent delimiter (%s)",
    async (multiSelectDelimiter) => {
      multiChoicePicks = [{ label: "red" }, { label: "blue" }];
      const prompted = await promptParameterValues(
        createOptions([
          {
            name: "COLORS",
            kind: "multiChoice",
            choices: ["red", "blue"],
            defaultValue: "red,blue",
            multiSelectDelimiter
          }
        ])
      );

      assert.deepEqual(
        quickPickCalls[0].map((item) => item.picked),
        [true, true]
      );
      assert.deepEqual(prompted?.payload.fields, [
        { name: "COLORS", value: "red" },
        { name: "COLORS", value: "blue" }
      ]);
    }
  );

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

  it.each(["password", "credentials"] as const)(
    "masks %s parameters and prefills the preset value",
    async (kind) => {
      await promptParameterValues(
        createOptions([{ name: "SECRET", kind, defaultValue: "default-secret" }]),
        { SECRET: "preset-secret" }
      );

      assert.equal(inputBoxCalls.length, 1);
      assert.equal(inputBoxCalls[0].password, true);
      assert.equal(inputBoxCalls[0].value, "preset-secret");
    }
  );

  it("does not mask plain string parameters and prefills the default value", async () => {
    inputBoxValue = "typed-value";
    const prompted = await promptParameterValues(
      createOptions([{ name: "BRANCH", kind: "string", defaultValue: "main" }])
    );

    assert.equal(inputBoxCalls.length, 1);
    assert.equal(inputBoxCalls[0].password, false);
    assert.equal(inputBoxCalls[0].value, "main");
    assert.deepEqual(prompted?.payload.fields, [{ name: "BRANCH", value: "typed-value" }]);
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

describe("promptParameterValues run parameters", () => {
  it.each([
    "folder/upstream",
    "job/folder/job/upstream/",
    "https://jenkins.example/job/folder/job/upstream/"
  ])("submits the externalizable run ID for %s", async (runProjectName) => {
    const options = createOptions([{ name: "RUN_BUILD", kind: "run", runProjectName }]);
    options.dataService = {
      getBuildsForJob: async () => [{ number: 42 }]
    } as unknown as BuildParameterPromptOptions["dataService"];
    quickPickActions = ["existing"];

    const prompted = await promptParameterValues(options);

    assert.deepEqual(prompted?.payload.fields, [
      { name: "RUN_BUILD", value: "folder/upstream#42" }
    ]);
    assert.equal(prompted?.values.RUN_BUILD, "folder/upstream#42");
  });
});

describe("fetchRunBuildChoices run parameter lookup", () => {
  it.each([
    ["foo", "https://jenkins.example/job/foo/"],
    ["folder/foo", "https://jenkins.example/job/folder/job/foo/"],
    ["job/folder/job/foo", "https://jenkins.example/job/folder/job/foo/"],
    ["https://jenkins.example/job/foo", "https://jenkins.example/job/foo/"]
  ])("queries one Jenkins job URL for %s", async (runProjectName, expectedJobUrl) => {
    const requestedJobUrls: string[] = [];
    const options = createOptions([
      {
        name: "RUN_BUILD",
        kind: "run",
        runProjectName
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

    assert.deepEqual(requestedJobUrls, [expectedJobUrl]);
  });

  it.each(["https://example.invalid/job/x/", "//example.invalid/job/x/"])(
    "does not request external runProjectName URL %s",
    async (runProjectName) => {
      const requestedJobUrls: string[] = [];
      const options = createOptions([
        {
          name: "RUN_BUILD",
          kind: "run",
          runProjectName
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
    }
  );

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
    assert.equal(choices[0]?.runId, "demo#42");
    assert.deepEqual(requestedJobUrls, [options.jobUrl]);
  });

  it("returns no choices after one failed lookup", async () => {
    const options = createOptions([{ name: "RUN_BUILD", kind: "run", runProjectName: "foo" }]);
    const getBuildsForJob = vi.fn().mockRejectedValue(new Error("Lookup failed"));
    options.dataService = {
      getBuildsForJob
    } as unknown as BuildParameterPromptOptions["dataService"];

    assert.deepEqual(await fetchRunBuildChoices(options, options.parameters[0]), []);
    assert.equal(getBuildsForJob.mock.calls.length, 1);
    assert.deepEqual(getBuildsForJob.mock.calls[0], [
      options.environment,
      "https://jenkins.example/job/foo/",
      20
    ]);
  });
});
