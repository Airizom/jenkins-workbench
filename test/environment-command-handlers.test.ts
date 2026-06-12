import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { BrowserSsoAuthenticator } from "../src/services/BrowserSsoAuthenticationService";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../src/storage/JenkinsEnvironmentStore";
import { exactModuleMock, suffixModuleMock, withModuleMocks } from "./helpers/moduleMock";

const errorMessages: string[] = [];

const vscodeMock = {
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined
  }
};

const promptsMock = {
  promptScope: async () => "workspace",
  promptRequiredInput: async (prompt: string) =>
    prompt === "Jenkins URL" ? "https://jenkins.example" : undefined,
  promptAuthMode: async () => "none",
  promptBrowserSsoLoginUrl: async () => undefined,
  promptHeadersJson: async () => undefined
};

const { addEnvironment } = withModuleMocks(
  [exactModuleMock("vscode", vscodeMock), suffixModuleMock("EnvironmentPrompts", promptsMock)],
  () =>
    require("../src/commands/environment/EnvironmentCommandHandlers") as typeof import(
      "../src/commands/environment/EnvironmentCommandHandlers"
    )
);

class FailingAuthEnvironmentStore {
  readonly added: Array<{ scope: EnvironmentScope; environment: JenkinsEnvironment }> = [];
  readonly removed: Array<{ scope: EnvironmentScope; id: string }> = [];

  async getEnvironments(): Promise<JenkinsEnvironment[]> {
    return [];
  }

  async addEnvironment(scope: EnvironmentScope, environment: JenkinsEnvironment): Promise<void> {
    this.added.push({ scope, environment });
  }

  async setAuthConfig(): Promise<void> {
    throw new Error("secret storage failed");
  }

  async removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
    this.removed.push({ scope, id });
    return true;
  }
}

beforeEach(() => {
  errorMessages.length = 0;
});

describe("addEnvironment", () => {
  it("rolls back the environment when authentication settings fail to persist", async () => {
    const store = new FailingAuthEnvironmentStore();
    const refreshedEnvironmentIds: string[] = [];

    await addEnvironment(
      store as unknown as JenkinsEnvironmentStore,
      {} as BrowserSsoAuthenticator,
      {
        fullEnvironmentRefresh: (request) => {
          if (request?.environmentId) {
            refreshedEnvironmentIds.push(request.environmentId);
          }
          return { executed: true };
        }
      }
    );

    assert.equal(store.added.length, 1);
    assert.deepEqual(store.removed, [
      {
        scope: "workspace",
        id: store.added[0].environment.id
      }
    ]);
    assert.deepEqual(refreshedEnvironmentIds, []);
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /Unable to store authentication settings/);
    assert.match(errorMessages[0], /secret storage failed/);
    assert.match(errorMessages[0], /partially added environment was removed/);
  });
});
