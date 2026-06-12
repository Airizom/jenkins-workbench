import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { BuildParameterPromptOptions } from "../src/ui/buildParameterPrompts/BuildParameterPromptTypes";
import { fetchRunBuildChoices } from "../src/ui/buildParameterPrompts/RunParameterLookup";
import { exactModuleMock, withModuleMocks } from "./helpers/moduleMock";

interface InputBoxOptions {
  readonly prompt?: string;
  readonly password?: boolean;
  readonly value?: string;
}

const inputBoxCalls: InputBoxOptions[] = [];
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
    showQuickPick: async () => undefined,
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

const { promptParameterValues } = withModuleMocks([exactModuleMock("vscode", vscodeMock)], () =>
  require("../src/ui/buildParameterPrompts/ParameterValuePrompts")
) as typeof import("../src/ui/buildParameterPrompts/ParameterValuePrompts");

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
  inputBoxValue = "typed-secret";
  openedTextDocuments = 0;
});

describe("promptParameterValues sensitive parameters", () => {
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

    assert.ok(requestedJobUrls.length > 0);
    assert.equal(requestedJobUrls.includes("https://example.invalid/job/x/"), false);
    assert.deepEqual(
      requestedJobUrls.filter((jobUrl) => new URL(jobUrl).origin !== "https://jenkins.example"),
      []
    );
  });
});
