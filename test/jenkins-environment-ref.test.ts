import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { toJenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";

describe("toJenkinsEnvironmentRef", () => {
  it("projects a scoped stored environment to a Jenkins environment reference", () => {
    assert.deepEqual(
      toJenkinsEnvironmentRef({
        id: "environment-id",
        scope: "workspace",
        url: "https://jenkins.example/",
        name: "Production",
        username: "user"
      }),
      {
        environmentId: "environment-id",
        scope: "workspace",
        url: "https://jenkins.example/",
        name: "Production",
        username: "user"
      }
    );
  });

  it.each([true, false, undefined, "true"])(
    "only propagates an explicit insecure TLS opt-in: %s",
    (allowInsecureTls) => {
      const ref = toJenkinsEnvironmentRef({
        id: "environment-id",
        scope: "workspace",
        url: "https://jenkins.example/",
        allowInsecureTls: allowInsecureTls as boolean | undefined
      });
      assert.equal(ref.allowInsecureTls, allowInsecureTls === true ? true : undefined);
    }
  );
});
