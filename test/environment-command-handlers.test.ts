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
const warningMessages: string[] = [];
let quickPickItems: unknown;
let warningMessageResponse: string | undefined;
let jenkinsUrlInput = "https://jenkins.example";
let authModePromptCount = 0;
let browserSsoLoginPromptCount = 0;

const vscodeMock = {
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showInformationMessage: async () => undefined,
    showWarningMessage: async (message: string) => {
      warningMessages.push(message);
      return warningMessageResponse;
    },
    showQuickPick: async (items: unknown) => {
      quickPickItems = items;
      return undefined;
    },
    showInputBox: async () => undefined
  }
};

const promptsMock = {
  promptScope: async () => "workspace",
  promptRequiredInput: async (prompt: string) =>
    prompt === "Jenkins URL" ? jenkinsUrlInput : undefined,
  promptAuthMode: async () => {
    authModePromptCount += 1;
    return "none";
  },
  promptBrowserSsoLoginUrl: async () => {
    browserSsoLoginPromptCount += 1;
    return undefined;
  },
  promptHeadersJson: async () => undefined
};

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => promptsMock);
const { addEnvironment, removeEnvironment, signInWithBrowserSso } = await import(
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
  warningMessages.length = 0;
  quickPickItems = undefined;
  warningMessageResponse = undefined;
  jenkinsUrlInput = "https://jenkins.example";
  authModePromptCount = 0;
  browserSsoLoginPromptCount = 0;
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

  it.each(["https://user@jenkins.example.com", "https://user:secret@jenkins.example.com"])(
    "rejects a URL containing embedded credentials: %s",
    async (url) => {
      jenkinsUrlInput = url;
      const getEnvironments = vi.fn(async () => []);

      await addEnvironment(
        { getEnvironments } as unknown as JenkinsEnvironmentStore,
        {} as BrowserSsoAuthenticator,
        { fullEnvironmentRefresh: () => ({ executed: true }) }
      );

      assert.equal(getEnvironments.mock.calls.length, 0);
      assert.equal(authModePromptCount, 0);
      assert.equal(errorMessages.length, 1);
      assert.match(errorMessages[0], /without embedded credentials/);
      assert.doesNotMatch(errorMessages[0], /user|secret/);
    }
  );
});

describe("signInWithBrowserSso", () => {
  it("blocks a legacy environment URL containing embedded credentials", async () => {
    const getAuthConfig = vi.fn(async () => undefined);
    const authenticate = vi.fn(async () => undefined);

    await signInWithBrowserSso(
      { getAuthConfig } as unknown as JenkinsEnvironmentStore,
      { authenticate } as unknown as BrowserSsoAuthenticator,
      {} as JenkinsClientProvider,
      { fullEnvironmentRefresh: () => ({ executed: true }) },
      {
        environmentId: "env-legacy",
        scope: "workspace",
        url: "https://user:secret@jenkins.example.com/"
      }
    );

    assert.equal(getAuthConfig.mock.calls.length, 0);
    assert.equal(authenticate.mock.calls.length, 0);
    assert.equal(browserSsoLoginPromptCount, 0);
    assert.equal(errorMessages.length, 1);
    assert.doesNotMatch(errorMessages[0], /user|secret/);
  });
});

describe("removeEnvironment", () => {
  it("redacts credentials from legacy environment picker labels", async () => {
    const store = {
      async listEnvironmentsWithScope() {
        return [
          {
            id: "env-legacy",
            scope: "workspace",
            url: "https://user:secret@jenkins.example.com/"
          }
        ];
      }
    } as unknown as JenkinsEnvironmentStore;

    await removeEnvironment(
      store,
      {} as JenkinsParameterPresetStore,
      {} as JenkinsWatchStore,
      {} as JenkinsPinStore,
      {} as JenkinsClientProvider,
      { fullEnvironmentRefresh: () => ({ executed: true }) }
    );

    const picks = quickPickItems as Array<{ label: string }>;
    assert.equal(picks[0].label, "https://jenkins.example.com/");
  });

  it("refreshes removed environment state when related cleanup fails", async () => {
    const target: JenkinsEnvironmentRef = {
      environmentId: "env-1",
      scope: "workspace",
      url: "https://user:secret@jenkins.example/"
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
    assert.match(warningMessages[0], /https:\/\/jenkins\.example\//);
    assert.doesNotMatch(warningMessages[0], /user|secret/);
  });
});
