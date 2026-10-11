import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveBusyExecutors } from "../src/jenkins/NodeFormatters";

describe("resolveBusyExecutors", () => {
  it("preserves the reported busy count for offline nodes", () => {
    assert.equal(resolveBusyExecutors({ offline: true, busyExecutors: 1 }, 2), 1);
  });

  it("counts running executables on offline nodes without a reported busy count", () => {
    assert.equal(
      resolveBusyExecutors(
        {
          offline: true,
          executors: [{ currentExecutable: { number: 1 } }, { idle: true, currentExecutable: null }]
        },
        2
      ),
      1
    );
  });
});
