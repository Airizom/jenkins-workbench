import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildTreeEnvironmentKey,
  deleteTreeEnvironmentKeys
} from "../src/tree/TreeEnvironmentKeys";

describe("deleteTreeEnvironmentKeys", () => {
  it("deletes keys built for the environment in every scope", () => {
    const map = new Map<string, number>([
      [buildTreeEnvironmentKey("workspace", "env-1"), 1],
      [buildTreeEnvironmentKey("global", "env-1"), 2],
      [buildTreeEnvironmentKey("global", "env-2"), 3],
      [buildTreeEnvironmentKey("global", "other-env-1x"), 4]
    ]);

    deleteTreeEnvironmentKeys(map, "env-1");

    assert.deepEqual([...map.values()], [3, 4]);
  });
});
