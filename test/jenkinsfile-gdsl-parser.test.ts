import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseJenkinsfileGdsl } from "../src/jenkinsfile/JenkinsfileGdslParser";

describe("Jenkinsfile GDSL parser", () => {
  it("parses method parameters with negative numeric literals", () => {
    const catalog = parseJenkinsfileGdsl(`
contributor(context(type: 'org.jenkinsci.plugins.workflow.cps.CpsScript')) {
  method(name: 'retryWithBackoff', params: [attempts: -1])
}
`);

    const step = catalog.steps.get("retryWithBackoff");

    assert.ok(step);
    assert.deepEqual(step.signatures[0], {
      label: "retryWithBackoff(attempts: -1)",
      parameters: [
        {
          name: "attempts",
          type: "-1",
          required: true,
          isBody: false
        }
      ],
      usesNamedArgs: false,
      takesClosure: false
    });
  });
});
