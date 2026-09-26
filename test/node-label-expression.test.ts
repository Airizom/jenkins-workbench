import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  evaluateLabelExpression,
  parseCompoundLabelExpression
} from "../src/services/NodeLabelExpression";

function matches(expression: string, labels: string[]): boolean {
  const parsed = parseCompoundLabelExpression(expression);
  assert.ok(parsed, `expected ${expression} to parse as a compound expression`);
  return evaluateLabelExpression(parsed, labels);
}

describe("NodeLabelExpression", () => {
  it("leaves plain and malformed labels to literal matching", () => {
    assert.equal(parseCompoundLabelExpression("linux"), undefined);
    assert.equal(parseCompoundLabelExpression("linux-x86_64"), undefined);
    assert.equal(parseCompoundLabelExpression('"docker host"'), undefined);
    assert.equal(parseCompoundLabelExpression("linux &&"), undefined);
    assert.equal(parseCompoundLabelExpression("(linux || windows"), undefined);
    assert.equal(parseCompoundLabelExpression('"unterminated && linux'), undefined);
  });

  it("applies Jenkins operator precedence", () => {
    assert.equal(matches("windows || linux && x86", ["windows"]), true);
    assert.equal(matches("windows || linux && x86", ["linux"]), false);
    assert.equal(matches("!linux && x86", ["x86"]), true);
    assert.equal(matches("!linux && x86", ["linux", "x86"]), false);
    assert.equal(matches("(windows || linux) && x86", ["linux", "x86"]), true);
  });

  it("evaluates implication, equivalence, and quoted labels", () => {
    assert.equal(matches("linux -> x86", ["windows"]), true);
    assert.equal(matches("linux -> x86", ["linux"]), false);
    assert.equal(matches("linux <-> x86", []), true);
    assert.equal(matches("linux <-> x86", ["x86"]), false);
    assert.equal(matches('"docker host" && linux', ["docker host", "linux"]), true);
  });

  it("compares labels case-insensitively like literal pool matching", () => {
    assert.equal(matches("Linux && X86", ["linux", "x86"]), true);
  });
});
