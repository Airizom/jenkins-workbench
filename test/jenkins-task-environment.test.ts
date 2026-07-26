import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { toJenkinsEnvironmentRef } from "../src/tasks/JenkinsTaskEnvironment";

describe("toJenkinsEnvironmentRef", () => {
  it("projects a scoped stored environment to a Jenkins environment reference", () => {
    assert.deepEqual(
      toJenkinsEnvironmentRef({
        id: "environment-id",
        scope: "workspace",
        url: "https://jenkins.example/",
        username: "user"
      }),
      {
        environmentId: "environment-id",
        scope: "workspace",
        url: "https://jenkins.example/",
        username: "user"
      }
    );
  });
});
