import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { parseJenkinsfileGdsl } from "../src/jenkinsfile/JenkinsfileGdslParser";
import {
  scanContributorBlocks,
  scanMethodCalls
} from "../src/jenkinsfile/gdsl/JenkinsfileGdslBlockScanner";
import { readGdslString, skipString } from "../src/jenkinsfile/gdsl/JenkinsfileGdslScannerUtils";
import { GdslTokenizer } from "../src/jenkinsfile/gdsl/JenkinsfileGdslTokenizer";

describe("Jenkinsfile GDSL parser", () => {
  it("ignores contributor declarations inside comments and strings", () => {
    const examples = [
      "// contributor(context: 'line') { method(name: 'fake') }",
      "/* contributor(context: 'block') { method(name: 'fake') } */",
      `"contributor(context: 'string') { method(name: 'fake') }"`,
      `'''contributor(context: 'triple') { method(name: 'fake') }'''`,
      "// contributor(context: 'unfinished') {"
    ];

    for (const example of examples) {
      assert.deepEqual(scanContributorBlocks(example), []);
    }

    const text = `${examples.join("\n")}\ncontributor(context: 'real') { method(name: 'real') }`;
    assert.deepEqual(scanContributorBlocks(text), [{ body: " method(name: 'real') " }]);
  });

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

  it("does not treat negated enclosing-call guards as positive context", () => {
    const calls = scanMethodCalls(`
if (!enclosingCall('stage')) { method(name: 'outsideStage') }
if (!enclosingCall('node')) { method(name: 'outsideNode') }
def outsideNode = !enclosingCall('node')
if (outsideNode) { method(name: 'aliasedOutsideNode') }
if (enclosingCall('node')) { method(name: 'insideNode') }
`);

    assert.deepEqual(
      calls.map(({ call, requiresNodeContext }) => ({
        name: call.args[0]?.value,
        requiresNodeContext
      })),
      [
        { name: "outsideStage", requiresNodeContext: false },
        { name: "outsideNode", requiresNodeContext: false },
        { name: "aliasedOutsideNode", requiresNodeContext: false },
        { name: "insideNode", requiresNodeContext: true }
      ]
    );
  });

  it("infers only guards required by boolean conditions", () => {
    const calls = scanMethodCalls(`
if (enclosingCall('stage') || enclosingCall('node')) { method(name: 'either') }
if (enclosingCall('node') && !enclosingCall('stage')) { method(name: 'nodeOnly') }
if (enclosingCall('stage') == false) { method(name: 'comparison') }
`);

    assert.deepEqual(
      calls.map(({ call, requiresNodeContext }) => ({
        name: call.args[0]?.value,
        requiresNodeContext
      })),
      [
        { name: "either", requiresNodeContext: false },
        { name: "nodeOnly", requiresNodeContext: true },
        { name: "comparison", requiresNodeContext: false }
      ]
    );
  });

  it("ignores quoted and commented parentheses when resolving guards", () => {
    const calls = scanMethodCalls(`
if (enclosingCall('node') && check(')')) { method(name: 'quoted') }
if (enclosingCall('node') && check(/* ) */ true)) { method(name: 'commented') }
`);

    assert.deepEqual(
      calls.map(({ call, requiresNodeContext }) => ({
        name: call.args[0]?.value,
        requiresNodeContext
      })),
      [
        { name: "quoted", requiresNodeContext: true },
        { name: "commented", requiresNodeContext: true }
      ]
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
