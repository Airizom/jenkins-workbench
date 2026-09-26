import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createUniqueListKeys } from "../src/panels/buildDetails/webview/components/buildDetails/buildFailure/buildFailureListKeys";

describe("build failure list keys", () => {
  it("creates unique keys for repeated or missing identities", () => {
    const keys = createUniqueListKeys(["a", undefined, "a", undefined, "b"], (item) => item);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("keeps keys stable for the first occurrence of an identity", () => {
    const first = createUniqueListKeys(["a", "b"], (item) => item);
    const second = createUniqueListKeys(["b", "a", "a"], (item) => item);
    assert.equal(first[0], second[1]);
    assert.equal(first[1], second[0]);
  });
});
