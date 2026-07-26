import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseJenkinsfileGdsl } from "../src/jenkinsfile/JenkinsfileGdslParser";
import { readGdslString, skipString } from "../src/jenkinsfile/gdsl/JenkinsfileGdslScannerUtils";
import { GdslTokenizer } from "../src/jenkinsfile/gdsl/JenkinsfileGdslTokenizer";

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

  it("uses the shared string reader for escaped and triple-quoted strings", () => {
    const escaped = String.raw`'escaped \' quote' trailing`;
    const escapedResult = readGdslString(escaped, 0);

    assert.deepEqual(escapedResult, {
      value: "escaped ' quote",
      end: escaped.indexOf(" trailing"),
      terminated: true
    });
    assert.deepEqual(new GdslTokenizer(escaped.slice(0, escapedResult.end)).next(), {
      type: "string",
      value: "escaped ' quote"
    });

    const tripleQuoted = `'''line one\n) } line two''' trailing`;
    const tripleResult = readGdslString(tripleQuoted, 0);

    assert.deepEqual(tripleResult, {
      value: "line one\n) } line two",
      end: tripleQuoted.indexOf(" trailing"),
      terminated: true
    });
  });

  it("preserves caller-specific behavior for unterminated strings", () => {
    const unterminated = "'unterminated";

    assert.deepEqual(readGdslString(unterminated, 0), {
      value: "unterminated",
      end: unterminated.length,
      terminated: false
    });
    assert.equal(skipString(unterminated, 0), unterminated.length);
    assert.throws(() => new GdslTokenizer(unterminated), /Unterminated GDSL string/);
  });
});
