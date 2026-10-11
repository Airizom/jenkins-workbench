import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { DefaultJenkinsTreeNavigator } from "../src/tree/TreeNavigator";
import * as vscodeStub from "./helpers/vscodeStub";

const errorMessages: string[] = [];
const warningMessages: string[] = [];

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showWarningMessage: async (message: string) => {
      warningMessages.push(message);
      return undefined;
    }
  }
}));

const { JenkinsWorkbenchDeepLinkJobHandler } = await import(
  "../src/extension/JenkinsWorkbenchDeepLinkJobHandler"
);

const environment: JenkinsEnvironmentRef = {
  scope: "workspace",
  environmentId: "env-1",
  url: "https://jenkins.example/"
};

describe("JenkinsWorkbenchDeepLinkJobHandler", () => {
  it("shows an error when revealing the job path fails", async () => {
    errorMessages.length = 0;
    warningMessages.length = 0;
    const treeNavigator = {
      revealJobPath: async () => {
        throw new Error("tree unavailable");
      }
    } as unknown as DefaultJenkinsTreeNavigator;
    const handler = new JenkinsWorkbenchDeepLinkJobHandler(treeNavigator);

    await handler.revealJob(environment, "https://jenkins.example/job/folder/job/app/");

    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /^Unable to open job: .*tree unavailable/);
    assert.equal(warningMessages.length, 0);
  });

  it("parses job paths below a context path named like a route marker", async () => {
    errorMessages.length = 0;
    const revealJobPath = vi.fn(async (_environment: unknown, _entry: unknown) => true);
    const handler = new JenkinsWorkbenchDeepLinkJobHandler({
      revealJobPath
    } as unknown as DefaultJenkinsTreeNavigator);

    await handler.revealJob(
      { ...environment, url: "https://jenkins.example/job/" },
      "https://jenkins.example/job/job/demo/"
    );

    assert.deepEqual(errorMessages, []);
    const entry = revealJobPath.mock.calls[0]?.[1] as { name: string; url: string } | undefined;
    assert.equal(entry?.name, "demo");
    assert.equal(entry?.url, "https://jenkins.example/job/job/demo/");
  });
});
