import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildPendingInputsViewModel } from "../src/panels/buildDetails/BuildDetailsPendingInputsViewModel";

describe("buildPendingInputsViewModel", () => {
  it("returns no inputs when Jenkins reports none", () => {
    assert.deepEqual(buildPendingInputsViewModel(undefined), []);
    assert.deepEqual(buildPendingInputsViewModel([]), []);
  });

  it("keeps inputs VS Code can submit off the browser path", () => {
    const [input] = buildPendingInputsViewModel([
      {
        id: "deploy",
        message: "Deploy?",
        submitter: "release-managers",
        parameters: [
          { name: "REGION", kind: "choice", choices: ["us-east-1"] },
          { name: "NOTE", kind: "string", rawType: "StringParameterDefinition" }
        ]
      }
    ]);

    assert.equal(input?.requiresBrowser, false);
    assert.equal(input?.submitterLabel, "Submitter: release-managers");
    assert.equal(input?.parametersLabel, "Parameters: REGION (Choice), NOTE (String)");
    assert.deepEqual(
      input?.parameters.map((param) => param.requiresBrowser),
      [undefined, undefined]
    );
  });

  it("flags browser-only parameters and shows plugin types by their own name", () => {
    const [input] = buildPendingInputsViewModel([
      {
        id: "release",
        message: "Release?",
        parameters: [
          { name: "NOTES", kind: "file" },
          { name: "TARGET", kind: "multiChoice", choices: [] },
          {
            name: "TAG",
            kind: "string",
            rawType: "net.uaznia.lukanus.GitParameterDefinition",
            isUnrecognizedType: true
          },
          { name: "CONFIRM", kind: "boolean", defaultValue: true }
        ]
      }
    ]);

    assert.equal(input?.requiresBrowser, true);
    assert.equal(input?.submitterLabel, "Submitter: Any");
    assert.deepEqual(
      input?.parameters.map((param) => [param.name, param.kind, param.requiresBrowser]),
      [
        ["NOTES", "File", true],
        ["TARGET", "Multi Choice", true],
        ["TAG", "GitParameterDefinition", true],
        ["CONFIRM", "Boolean", undefined]
      ]
    );
    assert.equal(
      input?.parametersLabel,
      "Parameters: NOTES (File), TARGET (Multi Choice), TAG (GitParameterDefinition), CONFIRM (Boolean)"
    );
  });
});
