import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { getCallParameters } from "../src/jenkinsfile/editor/JenkinsfileEditorSupport";

describe("getCallParameters", () => {
  it("omits body parameters and keeps call parameters in order", () => {
    const parameters = getCallParameters({
      label: "withEnv(overrides) { body }",
      usesNamedArgs: false,
      takesClosure: true,
      parameters: [
        { name: "overrides", type: "List" },
        { name: "body", type: "Closure", isBody: true },
        { name: "extra" }
      ]
    });

    assert.deepEqual(
      parameters.map((parameter) => parameter.name),
      ["overrides", "extra"]
    );
  });
});
