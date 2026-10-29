import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JobParameter } from "../src/jenkins/data/JenkinsDataTypes";
import { mapPendingInputActions } from "../src/jenkins/data/JenkinsParameterMapping";
import { buildPendingInputBrowserUrl } from "../src/jenkins/urls";
import {
  formatPendingInputParameterKind,
  getBrowserOnlyParameters,
  requiresBrowserForPendingInput
} from "../src/ui/buildParameterPrompts/PendingInputParameterSupport";

function param(overrides: Partial<JobParameter> & Pick<JobParameter, "kind">): JobParameter {
  return { name: "VALUE", ...overrides };
}

function mapInputParameter(type: string | undefined): JobParameter {
  const [action] = mapPendingInputActions([{ id: "gate", inputs: [{ name: "VALUE", type }] }]);
  const parameter = action?.parameters[0];
  assert.ok(parameter);
  return parameter;
}

describe("PendingInputParameterSupport", () => {
  it("requires the browser for file parameters", () => {
    assert.equal(requiresBrowserForPendingInput(param({ kind: "file" })), true);
    assert.equal(formatPendingInputParameterKind(param({ kind: "file" })), "File");
  });

  it("requires the browser only for choices Jenkins has not listed", () => {
    assert.equal(
      requiresBrowserForPendingInput(param({ kind: "choice", choices: ["a", "b"] })),
      false
    );
    assert.equal(
      requiresBrowserForPendingInput(param({ kind: "multiChoice", choices: ["a"] })),
      false
    );
    for (const kind of ["choice", "multiChoice"] as const) {
      assert.equal(requiresBrowserForPendingInput(param({ kind, choices: [] })), true);
      assert.equal(requiresBrowserForPendingInput(param({ kind })), true);
    }
  });

  it("requires the browser for unrecognized plugin types and labels them by short name", () => {
    for (const [rawType, label] of [
      ["GitParameterDefinition", "GitParameterDefinition"],
      [
        "org.jvnet.jenkins.plugins.nodelabelparameter.NodeParameterDefinition",
        "NodeParameterDefinition"
      ],
      ["PT_CHECKBOX", "PT_CHECKBOX"]
    ]) {
      const parameter = mapInputParameter(rawType);
      assert.equal(parameter.kind, "string", rawType);
      assert.equal(parameter.isUnrecognizedType, true, rawType);
      assert.equal(requiresBrowserForPendingInput(parameter), true, rawType);
      assert.equal(formatPendingInputParameterKind(parameter), label);
    }
  });

  it("sends Active Choices to the browser as a choice whose values Jenkins generates", () => {
    const parameter = mapInputParameter("org.biouml.plugins.ActiveChoiceParameterDefinition");
    assert.equal(parameter.kind, "choice");
    assert.equal(requiresBrowserForPendingInput(parameter), true);
    assert.equal(formatPendingInputParameterKind(parameter), "Choice");
  });

  it("keeps core string types and strings without a raw type in VS Code", () => {
    for (const rawType of [
      "StringParameterDefinition",
      "hudson.model.StringParameterDefinition",
      "WHideParameterDefinition",
      undefined
    ]) {
      const parameter = mapInputParameter(rawType);
      assert.equal(parameter.isUnrecognizedType, undefined, String(rawType));
      assert.equal(requiresBrowserForPendingInput(parameter), false, String(rawType));
      assert.equal(formatPendingInputParameterKind(parameter), "String");
    }
  });

  it("keeps the other supported kinds in VS Code", () => {
    for (const [kind, label] of [
      ["boolean", "Boolean"],
      ["password", "Password"],
      ["text", "Text"],
      ["run", "Run"],
      ["credentials", "Credentials"]
    ] as const) {
      const parameter = param({
        kind,
        rawType: "SomePluginParameterDefinition",
        runProjectName: "folder/app"
      });
      assert.equal(requiresBrowserForPendingInput(parameter), false, kind);
      assert.equal(formatPendingInputParameterKind(parameter), label);
    }
  });

  it("requires the browser for run parameters whose project Jenkins didn't report", () => {
    assert.equal(requiresBrowserForPendingInput(param({ kind: "run" })), true);
    assert.equal(requiresBrowserForPendingInput(param({ kind: "run", runProjectName: " " })), true);
    assert.equal(
      requiresBrowserForPendingInput(param({ kind: "run", runProjectName: "folder/app" })),
      false
    );
  });

  it("classifies the parameters wfapi reports, which nest choices and defaults", () => {
    const [action] = mapPendingInputActions([
      {
        id: "deploy",
        message: "Deploy?",
        inputs: [
          {
            type: "ChoiceParameterDefinition",
            name: "TARGET",
            definition: { defaultVal: "staging", choices: ["staging", "production"] }
          },
          { type: "StringParameterDefinition", name: "VERSION", definition: { defaultVal: "1.0" } },
          { type: "RunParameterDefinition", name: "UPSTREAM", definition: {} },
          { type: "ExtendedChoiceParameterDefinition", name: "REGIONS", definition: {} }
        ]
      }
    ]);
    const [target, version, upstream, regions] = action?.parameters ?? [];
    assert.deepEqual(target?.choices, ["staging", "production"]);
    assert.equal(target?.defaultValue, "staging");
    assert.equal(version?.defaultValue, "1.0");
    assert.deepEqual(
      action?.parameters.map((parameter) => [
        parameter.name,
        requiresBrowserForPendingInput(parameter)
      ]),
      [
        ["TARGET", false],
        ["VERSION", false],
        ["UPSTREAM", true],
        ["REGIONS", true]
      ]
    );
    assert.equal(upstream?.kind, "run");
    assert.equal(regions?.kind, "multiChoice");
  });

  it("drops the plaintext defaults wfapi reports for sensitive parameters", () => {
    const [action] = mapPendingInputActions([
      {
        id: "deploy",
        inputs: [
          {
            type: "PasswordParameterDefinition",
            name: "TOKEN",
            definition: { defaultVal: "s3cret" }
          },
          { type: "CredentialsParameterDefinition", name: "KEY", defaultValue: "prod-key" }
        ]
      }
    ]);
    assert.deepEqual(
      action?.parameters.map((parameter) => [parameter.name, parameter.defaultValue]),
      [
        ["TOKEN", undefined],
        ["KEY", undefined]
      ]
    );
    assert.doesNotMatch(JSON.stringify(action), /s3cret|prod-key/);
  });

  it("filters the parameters that need the browser", () => {
    const file = param({ name: "NOTES", kind: "file" });
    const text = param({ name: "NOTE", kind: "text" });
    assert.deepEqual(getBrowserOnlyParameters([text, file]), [file]);
  });

  it("builds the build's input page URL", () => {
    assert.equal(buildPendingInputBrowserUrl("https://j/job/a/7"), "https://j/job/a/7/input/");
    assert.equal(buildPendingInputBrowserUrl("https://j/job/a/7/"), "https://j/job/a/7/input/");
  });
});
