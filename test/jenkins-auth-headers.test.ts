import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildAuthHeaders, parseHeadersJson } from "../src/jenkins/auth";

describe("parseHeadersJson", () => {
  it("accepts valid header names and values", () => {
    assert.deepEqual(parseHeadersJson('{" X-Token ":" abc\\tdef "}'), {
      headers: { "X-Token": "abc\tdef" }
    });
  });

  it("rejects header names that are not HTTP tokens", () => {
    const result = parseHeadersJson('{"X Token":"a"}');
    assert.equal(result.headers, undefined);
    assert.equal(result.error, 'Header name "X Token" contains invalid characters.');
  });

  it("rejects header values Node would refuse, such as control or non-Latin-1 characters", () => {
    for (const value of ["a\\r\\nb", "a\\u0000b", "a\\u007fb", "a\\u20acb"]) {
      const result = parseHeadersJson(`{"X-A":"${value}"}`);
      assert.equal(result.headers, undefined);
      assert.equal(result.error, 'Header "X-A" contains invalid characters.');
    }
  });

  it("accepts tabs and Latin-1 characters in header values", () => {
    const result = parseHeadersJson('{"X-A":"a\\tb\\u00e9"}');
    assert.equal(result.error, undefined);
    assert.equal(result.headers?.["X-A"], "a\tb\u00e9");
  });

  it("keeps a __proto__ header instead of silently dropping it", () => {
    const result = parseHeadersJson('{"__proto__":"value"}');
    assert.equal(result.error, undefined);
    assert.deepEqual(Object.entries(result.headers ?? {}), [["__proto__", "value"]]);
    const built = buildAuthHeaders({ type: "headers", headers: result.headers ?? {} });
    assert.deepEqual(Object.entries(built.headers ?? {}), [["__proto__", "value"]]);
  });
});
