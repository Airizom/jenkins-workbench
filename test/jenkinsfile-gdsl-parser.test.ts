import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { parseJenkinsfileGdsl } from "../src/jenkinsfile/JenkinsfileGdslParser";
import { scanMethodCalls } from "../src/jenkinsfile/gdsl/JenkinsfileGdslBlockScanner";
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

  it("preserves named and positional signatures with identical labels", () => {
    const catalog = parseJenkinsfileGdsl(`
contributor(context(type: 'org.jenkinsci.plugins.workflow.cps.CpsScript')) {
  method(
    name: 'echoValue',
    params: [value: 'String'],
    namedParams: [parameter(name: 'value', type: 'String')]
  )
}
`);

    const step = catalog.steps.get("echoValue");

    assert.ok(step);
    assert.deepEqual(
      step.signatures.map(({ label, usesNamedArgs }) => ({ label, usesNamedArgs })),
      [
        { label: "echoValue(value: String)", usesNamedArgs: true },
        { label: "echoValue(value: String)", usesNamedArgs: false }
      ]
    );
  });

  it("recognizes method calls only at identifier boundaries", () => {
    const calls = scanMethodCalls(`
amethod(name: 'prefixed')
methodCall(name: 'suffixed')
method(name: 'valid')
`);

    assert.deepEqual(
      calls.map(({ call }) => call.args[0]?.value),
      ["valid"]
    );
  });

  it("does not search the remaining suffix at each position", () => {
    const indexOf = vi.spyOn(String.prototype, "indexOf");
    try {
      assert.deepEqual(scanMethodCalls("x".repeat(10_000)), []);
      assert.equal(indexOf.mock.calls.length, 0);
    } finally {
      indexOf.mockRestore();
    }
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
