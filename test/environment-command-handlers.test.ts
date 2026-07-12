import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { BrowserSsoAuthenticator } from "../src/services/BrowserSsoAuthenticationService";
import type { JenkinsClientProvider } from "../src/jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentScope,
  JenkinsEnvironment,
  JenkinsEnvironmentStore
} from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";

const errorMessages: string[] = [];
let warningMessageResponse: string | undefined;

const vscodeMock = {
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => warningMessageResponse,
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

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => promptsMock);
const { addEnvironment, removeEnvironment } = await import(
  "../src/commands/environment/EnvironmentCommandHandlers"
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
  warningMessageResponse = undefined;
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

describe("removeEnvironment", () => {
  it("refreshes removed environment state when related cleanup fails", async () => {
    const target: JenkinsEnvironmentRef = {
      environmentId: "env-1",
      scope: "workspace",
      url: "https://jenkins.example/"
    };
    const events: string[] = [];
    warningMessageResponse = "Remove Environment";

    const store = {
      async removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
        events.push(`remove:${scope}:${id}`);
        return true;
      }
    } as unknown as JenkinsEnvironmentStore;
    const presetStore = {
      async removePresetsForEnvironment(
        scope: EnvironmentScope,
        environmentId: string
      ): Promise<void> {
        events.push(`presets:${scope}:${environmentId}`);
        throw new Error("preset cleanup failed");
      }
    } as unknown as JenkinsParameterPresetStore;
    const watchStore = {
      async removeWatchesForEnvironment(
        scope: EnvironmentScope,
        environmentId: string
      ): Promise<void> {
        events.push(`watches:${scope}:${environmentId}`);
      }
    } as unknown as JenkinsWatchStore;
    const pinStore = {
      async removePinsForEnvironment(
        scope: EnvironmentScope,
        environmentId: string
      ): Promise<void> {
        events.push(`pins:${scope}:${environmentId}`);
      }
    } as unknown as JenkinsPinStore;
    const clientProvider = {
      invalidateClient(scope: EnvironmentScope, environmentId: string): void {
        events.push(`invalidate:${scope}:${environmentId}`);
      }
    } as unknown as JenkinsClientProvider;

    await removeEnvironment(
      store,
      presetStore,
      watchStore,
      pinStore,
      clientProvider,
      {
        onEnvironmentRemoved: (environment) => {
          events.push(`removed:${environment.scope}:${environment.environmentId}`);
        },
        fullEnvironmentRefresh: (request) => {
          events.push(`refresh:${request?.environmentId}`);
          return { executed: true };
        }
      },
      target
    );

    assert.deepEqual(events, [
      "remove:workspace:env-1",
      "presets:workspace:env-1",
      "watches:workspace:env-1",
      "pins:workspace:env-1",
      "invalidate:workspace:env-1",
      "removed:workspace:env-1",
      "refresh:env-1"
    ]);
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /environment was removed/);
    assert.match(errorMessages[0], /preset cleanup failed/);
  });
});
