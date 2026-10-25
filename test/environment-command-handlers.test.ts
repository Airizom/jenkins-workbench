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
import type { JenkinsDiagnosticProfileBindingStore } from "../src/storage/JenkinsDiagnosticProfileBindingStore";
import type { JenkinsParameterPresetStore } from "../src/storage/JenkinsParameterPresetStore";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import type { JenkinsWatchStore } from "../src/storage/JenkinsWatchStore";

import { createExtensionContext } from "./helpers/storageMocks";
import { EventEmitter } from "./helpers/vscodeStub";
import type { EnvironmentUrlRebaseService } from "../src/services/EnvironmentUrlRebaseService";
import type { JenkinsAuthConfig } from "../src/jenkins/types";

const errorMessages: string[] = [];
const warningMessages: string[] = [];
const infoMessages: Array<{ message: string; items: string[] }> = [];
let quickPickItems: unknown;
let warningMessageResponse: string | undefined;
let infoMessageResponse: string | undefined;
let jenkinsUrlInput: string | undefined = "https://jenkins.example";
let authModePromptCount = 0;
let authModeResponse: string | undefined = "none";
const authModePromptCurrents: Array<string | undefined> = [];
let onAuthModePrompt: (() => Promise<void>) | undefined;
let browserSsoLoginPromptCount = 0;
let browserSsoLoginUrl: string | undefined;
const browserSsoLoginPrefills: Array<string | undefined> = [];
let environmentNameInput: string | undefined = "";
const environmentNamePrompts: Array<{ url: string; current?: string }> = [];
let editFieldResponse: string | undefined;
let tlsResponse: boolean | undefined = false;
const tlsPromptCurrents: Array<boolean | undefined> = [];
const requiredInputResponses = new Map<string, string | undefined>();
const requiredInputPrefills = new Map<string, string | undefined>();

const vscodeMock = {
  EventEmitter,
  window: {
    showErrorMessage: async (message: string) => {
      errorMessages.push(message);
      return undefined;
    },
    showInformationMessage: async (message: string, ...items: string[]) => {
      infoMessages.push({ message, items });
      return infoMessageResponse;
    },
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
  promptTlsCertificateValidation: async (current?: boolean) => {
    tlsPromptCurrents.push(current);
    return tlsResponse;
  },
  promptScope: async () => "workspace",
  promptRequiredInput: async (
    prompt: string,
    _placeHolder?: string,
    _password?: boolean,
    options?: { value?: string }
  ) => {
    requiredInputPrefills.set(prompt, options?.value);
    return prompt === "Jenkins URL" ? jenkinsUrlInput : requiredInputResponses.get(prompt);
  },
  promptAuthMode: async (current?: string) => {
    authModePromptCount += 1;
    authModePromptCurrents.push(current);
    await onAuthModePrompt?.();
    return authModeResponse;
  },
  promptBrowserSsoLoginUrl: async (_environmentUrl: string, initialValue?: string) => {
    browserSsoLoginPromptCount += 1;
    browserSsoLoginPrefills.push(initialValue);
    return browserSsoLoginUrl;
  },
  promptEnvironmentName: async (url: string, current?: string) => {
    environmentNamePrompts.push({ url, current });
    return environmentNameInput;
  },
  promptEditField: async () => editFieldResponse,
  promptHeadersJson: async () => undefined
};

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => promptsMock);
const { addEnvironment, editEnvironment, removeEnvironment, signInWithBrowserSso } = await import(
  "../src/commands/environment/EnvironmentCommandHandlers"
);

const { JenkinsEnvironmentStore: EnvironmentStore } = await import(
  "../src/storage/JenkinsEnvironmentStore"
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
  infoMessages.length = 0;
  quickPickItems = undefined;
  warningMessageResponse = undefined;
  infoMessageResponse = undefined;
  jenkinsUrlInput = "https://jenkins.example";
  authModePromptCount = 0;
  authModeResponse = "none";
  authModePromptCurrents.length = 0;
  onAuthModePrompt = undefined;
  browserSsoLoginPromptCount = 0;
  browserSsoLoginUrl = undefined;
  browserSsoLoginPrefills.length = 0;
  environmentNameInput = "";
  environmentNamePrompts.length = 0;
  editFieldResponse = undefined;
  tlsResponse = false;
  tlsPromptCurrents.length = 0;
  requiredInputResponses.clear();
  requiredInputPrefills.clear();
});

describe("addEnvironment", () => {
  it.each([true, false])("saves the HTTPS TLS choice %s", async (enabled) => {
    tlsResponse = enabled;
    const store = new EnvironmentStore(createExtensionContext());
    await addEnvironment(store, {} as BrowserSsoAuthenticator, {
      fullEnvironmentRefresh: () => ({ executed: true })
    });
    const [environment] = await store.getEnvironments("workspace");
    assert.equal(environment.allowInsecureTls === true, enabled);
    assert.deepEqual(tlsPromptCurrents, [undefined]);
  });

  it("saves nothing when the TLS choice or warning is dismissed", async () => {
    tlsResponse = undefined;
    const store = new EnvironmentStore(createExtensionContext());
    await addEnvironment(store, {} as BrowserSsoAuthenticator, {
      fullEnvironmentRefresh: () => ({ executed: true })
    });
    assert.deepEqual(await store.getEnvironments("workspace"), []);
    assert.equal(authModePromptCount, 0);
  });

  it("skips TLS setup for HTTP environments", async () => {
    jenkinsUrlInput = "http://jenkins.example";
    tlsResponse = true;
    const store = new EnvironmentStore(createExtensionContext());
    await addEnvironment(store, {} as BrowserSsoAuthenticator, {
      fullEnvironmentRefresh: () => ({ executed: true })
    });
    assert.deepEqual(tlsPromptCurrents, []);
    assert.equal((await store.getEnvironments("workspace"))[0].allowInsecureTls, undefined);
  });

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

describe("addEnvironment display name", () => {
  const add = async (store: JenkinsEnvironmentStore) =>
    addEnvironment(store, {} as BrowserSsoAuthenticator, {
      fullEnvironmentRefresh: () => ({ executed: true })
    });

  it("stores the optional display name", async () => {
    const store = new EnvironmentStore(createExtensionContext());
    environmentNameInput = "Production";

    await add(store);

    const [environment] = await store.getEnvironments("workspace");
    assert.equal(environment.name, "Production");
    assert.equal(environment.url, "https://jenkins.example/");
    assert.deepEqual(environmentNamePrompts, [
      { url: "https://jenkins.example/", current: undefined }
    ]);
  });

  it("omits the name when it is left empty", async () => {
    const store = new EnvironmentStore(createExtensionContext());

    await add(store);

    const [environment] = await store.getEnvironments("workspace");
    assert.equal("name" in environment, false);
    assert.equal(authModePromptCount, 1);
  });

  it("aborts when the name prompt is dismissed", async () => {
    const store = new EnvironmentStore(createExtensionContext());
    environmentNameInput = undefined;

    await add(store);

    assert.deepEqual(await store.getEnvironments("workspace"), []);
    assert.equal(authModePromptCount, 0);
  });
});

describe("signInWithBrowserSso", () => {
  it.each(["not-json", JSON.stringify({ type: "unsupported" })])(
    "saves credentials on the first sign-in after cleaning invalid auth: %s",
    async (invalidAuth) => {
      const context = createExtensionContext();
      const store = new EnvironmentStore(context);
      const target = {
        environmentId: "env-invalid",
        scope: "workspace" as const,
        url: "https://jenkins.example/"
      };
      await store.addEnvironment(target.scope, { id: target.environmentId, url: target.url });
      await context.secrets.store(
        "jenkinsWorkbench.envAuthConfig.workspace.env-invalid",
        invalidAuth
      );
      browserSsoLoginUrl = "https://login.example/";
      const authConfig: JenkinsAuthConfig = {
        type: "sso",
        loginUrl: browserSsoLoginUrl,
        headers: { Cookie: "session=new" },
        expiresAt: undefined
      };
      const authenticate = vi.fn(async () => authConfig);
      const invalidateClient = vi.fn();
      const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));

      await signInWithBrowserSso(
        store,
        { authenticate },
        { invalidateClient } as unknown as JenkinsClientProvider,
        { fullEnvironmentRefresh },
        target
      );

      assert.equal(store.getAuthConfigRevision(target.scope, target.environmentId), 2);
      assert.deepEqual(await store.getAuthConfig(target.scope, target.environmentId), authConfig);
      assert.equal(authenticate.mock.calls.length, 1);
      assert.equal(browserSsoLoginPromptCount, 1);
      assert.equal(invalidateClient.mock.calls.length, 1);
      assert.equal(fullEnvironmentRefresh.mock.calls.length, 1);
    }
  );

  it.each(["unchanged", "newer sign-in", "removed"] as const)(
    "saves pending credentials only when the environment is %s",
    async (change) => {
      const store = new EnvironmentStore(createExtensionContext());
      const target = {
        environmentId: "env-1",
        scope: "workspace" as const,
        url: "https://jenkins.example/"
      };
      const auth = (cookie: string): JenkinsAuthConfig => ({
        type: "sso",
        loginUrl: "https://login.example/",
        headers: { Cookie: cookie },
        expiresAt: undefined
      });
      await store.addEnvironment(target.scope, { id: target.environmentId, url: target.url });
      await store.setAuthConfig(target.scope, target.environmentId, auth("original"));
      let finish!: (value: JenkinsAuthConfig) => void;
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = new Promise<JenkinsAuthConfig>((resolve) => {
        finish = resolve;
      });
      const invalidateClient = vi.fn();
      const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));
      const run = (authenticate: BrowserSsoAuthenticator["authenticate"]) =>
        signInWithBrowserSso(
          store,
          { authenticate },
          { invalidateClient } as unknown as JenkinsClientProvider,
          { fullEnvironmentRefresh },
          target
        );
      const first = run(() => {
        started();
        return pending;
      });
      await ready;
      if (change === "newer sign-in") {
        await run(async () => auth("newer"));
      } else if (change === "removed") {
        await store.removeEnvironment(target.scope, target.environmentId);
      }
      invalidateClient.mockClear();
      fullEnvironmentRefresh.mockClear();
      finish(auth("pending"));
      await first;
      assert.deepEqual(
        await store.getAuthConfig(target.scope, target.environmentId),
        change === "removed" ? undefined : auth(change === "unchanged" ? "pending" : "newer")
      );
      assert.equal(invalidateClient.mock.calls.length, change === "unchanged" ? 1 : 0);
      assert.equal(fullEnvironmentRefresh.mock.calls.length, change === "unchanged" ? 1 : 0);
    }
  );

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
      {} as JenkinsDiagnosticProfileBindingStore,
      {} as JenkinsParameterPresetStore,
      {} as JenkinsWatchStore,
      {} as JenkinsPinStore,
      {} as JenkinsClientProvider,
      { fullEnvironmentRefresh: () => ({ executed: true }) }
    );

    const picks = quickPickItems as Array<{ label: string }>;
    assert.equal(picks[0].label, "https://jenkins.example.com/");
  });

  it("labels named environments by name and shows the redacted URL as detail", async () => {
    const store = {
      async listEnvironmentsWithScope() {
        return [
          {
            id: "env-named",
            scope: "global",
            name: "Production",
            url: "https://user:secret@jenkins.example.com/"
          }
        ];
      }
    } as unknown as JenkinsEnvironmentStore;

    await removeEnvironment(
      store,
      {} as JenkinsDiagnosticProfileBindingStore,
      {} as JenkinsParameterPresetStore,
      {} as JenkinsWatchStore,
      {} as JenkinsPinStore,
      {} as JenkinsClientProvider,
      { fullEnvironmentRefresh: () => ({ executed: true }) }
    );

    const picks = quickPickItems as Array<{ label: string; detail?: string }>;
    assert.equal(picks[0].label, "Production");
    assert.equal(picks[0].detail, "https://jenkins.example.com/");
  });

  it("names a named environment in the removal confirmation", async () => {
    await removeEnvironment(
      {} as JenkinsEnvironmentStore,
      {} as JenkinsDiagnosticProfileBindingStore,
      {} as JenkinsParameterPresetStore,
      {} as JenkinsWatchStore,
      {} as JenkinsPinStore,
      {} as JenkinsClientProvider,
      { fullEnvironmentRefresh: () => ({ executed: true }) },
      {
        environmentId: "env-1",
        scope: "workspace",
        name: "Production",
        url: "https://jenkins.example/"
      }
    );

    assert.match(warningMessages[0], /Remove the Jenkins environment Production\?/);
  });

  it.each(["bindings", "presets", "watches", "pins"] as const)(
    "refreshes a removed environment when %s cleanup fails",
    async (failingCleanup) => {
      const target: JenkinsEnvironmentRef = {
        environmentId: "env-1",
        scope: "workspace",
        url: "https://user:secret@jenkins.example/"
      };
      const events: string[] = [];
      const records = new Set(["bindings", "presets", "watches", "pins"]);
      let environmentExists = true;
      warningMessageResponse = "Remove Environment";

      const runCleanup = async (
        cleanup: "bindings" | "presets" | "watches" | "pins",
        scope: EnvironmentScope,
        environmentId: string
      ): Promise<void> => {
        events.push(`${cleanup}:${scope}:${environmentId}`);
        if (cleanup === failingCleanup) {
          throw new Error(`${cleanup} cleanup failed`);
        }
        records.delete(cleanup);
      };

      const store = {
        async removeEnvironment(scope: EnvironmentScope, id: string): Promise<boolean> {
          events.push(`remove:${scope}:${id}`);
          environmentExists = false;
          return true;
        }
      } as unknown as JenkinsEnvironmentStore;
      const presetStore = {
        async removePresetsForEnvironment(
          scope: EnvironmentScope,
          environmentId: string
        ): Promise<void> {
          await runCleanup("presets", scope, environmentId);
        }
      } as unknown as JenkinsParameterPresetStore;
      const bindingStore = {
        async removeBindingsForEnvironment(
          scope: EnvironmentScope,
          environmentId: string
        ): Promise<boolean> {
          await runCleanup("bindings", scope, environmentId);
          return true;
        }
      } as unknown as JenkinsDiagnosticProfileBindingStore;
      const watchStore = {
        async removeWatchesForEnvironment(
          scope: EnvironmentScope,
          environmentId: string
        ): Promise<void> {
          await runCleanup("watches", scope, environmentId);
        }
      } as unknown as JenkinsWatchStore;
      const pinStore = {
        async removePinsForEnvironment(
          scope: EnvironmentScope,
          environmentId: string
        ): Promise<void> {
          await runCleanup("pins", scope, environmentId);
        }
      } as unknown as JenkinsPinStore;
      const clientProvider = {
        invalidateClient(scope: EnvironmentScope, environmentId: string): void {
          events.push(`invalidate:${scope}:${environmentId}`);
        }
      } as unknown as JenkinsClientProvider;

      await removeEnvironment(
        store,
        bindingStore,
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
        "bindings:workspace:env-1",
        "presets:workspace:env-1",
        "watches:workspace:env-1",
        "pins:workspace:env-1",
        "invalidate:workspace:env-1",
        "removed:workspace:env-1",
        "refresh:env-1"
      ]);
      assert.equal(environmentExists, false);
      assert.deepEqual([...records], [failingCleanup]);
      assert.equal(errorMessages.length, 1);
      assert.match(errorMessages[0], /environment was removed/);
      assert.match(errorMessages[0], new RegExp(`${failingCleanup} cleanup failed`));
      assert.match(warningMessages[0], /https:\/\/jenkins\.example\//);
      assert.doesNotMatch(warningMessages[0], /user|secret/);
    }
  );

  it.each([false, true])(
    "handles a removal error according to whether the environment still exists: %s",
    async (environmentExists) => {
      warningMessageResponse = "Remove Environment";
      const cleanup = vi.fn(async () => undefined);
      const invalidateClient = vi.fn();
      const onEnvironmentRemoved = vi.fn();
      const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));
      const store = {
        async removeEnvironment(): Promise<boolean> {
          throw new Error("environment store failed");
        },
        async getEnvironments(): Promise<JenkinsEnvironment[]> {
          return environmentExists ? [{ id: "env-1", url: "https://jenkins.example/" }] : [];
        }
      } as unknown as JenkinsEnvironmentStore;

      await removeEnvironment(
        store,
        {
          removeBindingsForEnvironment: cleanup
        } as unknown as JenkinsDiagnosticProfileBindingStore,
        { removePresetsForEnvironment: cleanup } as unknown as JenkinsParameterPresetStore,
        { removeWatchesForEnvironment: cleanup } as unknown as JenkinsWatchStore,
        { removePinsForEnvironment: cleanup } as unknown as JenkinsPinStore,
        { invalidateClient } as unknown as JenkinsClientProvider,
        { onEnvironmentRemoved, fullEnvironmentRefresh },
        { environmentId: "env-1", scope: "workspace", url: "https://jenkins.example/" }
      );

      assert.equal(cleanup.mock.calls.length, environmentExists ? 0 : 4);
      assert.equal(invalidateClient.mock.calls.length, environmentExists ? 0 : 1);
      assert.equal(onEnvironmentRemoved.mock.calls.length, environmentExists ? 0 : 1);
      assert.equal(fullEnvironmentRefresh.mock.calls.length, environmentExists ? 0 : 1);
      assert.match(
        errorMessages[0],
        environmentExists ? /environment was not removed/ : /environment was removed/
      );
      assert.match(errorMessages[0], /environment store failed/);
    }
  );
});

describe("editEnvironment", () => {
  const sso = (cookie: string, loginUrl = "https://login.example/custom"): JenkinsAuthConfig => ({
    type: "sso",
    loginUrl,
    headers: { Cookie: cookie },
    expiresAt: undefined
  });

  async function createFixture(
    options: {
      environment?: Partial<JenkinsEnvironment>;
      auth?: JenkinsAuthConfig;
      others?: JenkinsEnvironment[];
    } = {}
  ) {
    const store = new EnvironmentStore(createExtensionContext());
    const environment: JenkinsEnvironment = {
      id: "env-1",
      url: "https://jenkins.example/",
      ...options.environment
    };
    await store.addEnvironment("workspace", environment);
    for (const other of options.others ?? []) {
      await store.addEnvironment("workspace", other);
    }
    if (options.auth) {
      await store.setAuthConfig("workspace", environment.id, options.auth);
    }
    const events: string[] = [];
    const rebaseFailures: unknown[] = [];
    store.onDidChange((change) => {
      if (change.kind === "environment-updated" && change.urlChanged) {
        events.push(`url-changed:${change.scope}:${change.environmentId}`);
      }
    });
    const rebase = vi.fn<EnvironmentUrlRebaseService["changeUrl"]>(async (scope, id, url) => {
      const update = await store.updateEnvironment(
        scope,
        id,
        { url },
        {
          beforeNotify: async ({ next }) => {
            events.push(`rebase:${scope}:${next.url}`);
          }
        }
      );
      return update ? { update, failures: rebaseFailures } : undefined;
    });
    const authenticate = vi.fn<BrowserSsoAuthenticator["authenticate"]>(async () => undefined);
    const dependencies = {
      store,
      browserSsoAuthenticator: { authenticate },
      clientProvider: {
        invalidateClient(scope: EnvironmentScope, environmentId: string): void {
          events.push(`invalidate:${scope}:${environmentId}`);
        }
      } as unknown as JenkinsClientProvider,
      urlRebaseService: { changeUrl: rebase },
      refreshHost: {
        fullEnvironmentRefresh(request?: { environmentId?: string }) {
          events.push(`refresh:${request?.environmentId}`);
          return { executed: true };
        }
      }
    };
    const target: JenkinsEnvironmentRef = {
      environmentId: environment.id,
      scope: "workspace",
      url: environment.url
    };
    const read = async () =>
      (await store.getEnvironments("workspace")).find((entry) => entry.id === environment.id);
    return { store, dependencies, events, rebase, rebaseFailures, authenticate, target, read };
  }

  it("warns when the selected environment no longer exists", async () => {
    const { dependencies, events, target } = await createFixture();
    editFieldResponse = "name";

    await editEnvironment(dependencies, { ...target, environmentId: "missing" });

    assert.deepEqual(warningMessages, ["The selected environment no longer exists."]);
    assert.deepEqual(events, []);
  });

  describe("TLS Certificate Validation", () => {
    beforeEach(() => {
      editFieldResponse = "tls";
    });

    it.each([true, false])("changes TLS policy to %s and refreshes", async (enabled) => {
      const { dependencies, events, target, read } = await createFixture({
        environment: { allowInsecureTls: !enabled }
      });
      tlsResponse = enabled;
      await editEnvironment(dependencies, target);
      assert.equal((await read())?.allowInsecureTls === true, enabled);
      assert.deepEqual(tlsPromptCurrents, [!enabled]);
      assert.deepEqual(events, ["invalidate:workspace:env-1", "refresh:env-1"]);
      assert.match(infoMessages[0].message, /Open panels.*were closed/);
    });

    it.each([undefined, true])(
      "leaves the setting unchanged for selection %s",
      async (response) => {
        const { dependencies, events, target, read } = await createFixture({
          environment: { allowInsecureTls: true }
        });
        tlsResponse = response;
        await editEnvironment(dependencies, target);
        assert.equal((await read())?.allowInsecureTls, true);
        assert.deepEqual(events, []);
      }
    );

    it("does not offer TLS editing to HTTP targets", async () => {
      const { dependencies, target, events } = await createFixture({
        environment: { url: "http://jenkins.example/" }
      });
      await editEnvironment(dependencies, target);
      assert.deepEqual(tlsPromptCurrents, []);
      assert.deepEqual(events, []);
    });

    it("explains an insecure TLS reset when the URL origin changes", async () => {
      const { dependencies, target, read } = await createFixture({
        environment: { allowInsecureTls: true }
      });
      editFieldResponse = "url";
      jenkinsUrlInput = "https://new.example/";
      await editEnvironment(dependencies, target);
      assert.equal((await read())?.allowInsecureTls, undefined);
      assert.match(
        infoMessages[0].message,
        /verification was re-enabled because the URL origin changed/
      );
    });
  });

  describe("Rename", () => {
    beforeEach(() => {
      editFieldResponse = "name";
    });

    it("sets the display name and refreshes", async () => {
      const { dependencies, events, target, read } = await createFixture();
      environmentNameInput = "Production";

      await editEnvironment(dependencies, target);

      assert.equal((await read())?.name, "Production");
      assert.deepEqual(environmentNamePrompts, [
        { url: "https://jenkins.example/", current: undefined }
      ]);
      assert.deepEqual(events, ["refresh:env-1"]);
    });

    it("clears the display name when the input is emptied", async () => {
      const { dependencies, events, target, read } = await createFixture({
        environment: { name: "Old name" }
      });
      environmentNameInput = "";

      await editEnvironment(dependencies, target);

      const environment = await read();
      assert.equal(environment && "name" in environment, false);
      assert.equal(environmentNamePrompts[0].current, "Old name");
      assert.deepEqual(events, ["refresh:env-1"]);
    });

    it("leaves the environment untouched when the prompt is dismissed", async () => {
      const { dependencies, events, target, read } = await createFixture({
        environment: { name: "Old name" }
      });
      environmentNameInput = undefined;

      await editEnvironment(dependencies, target);

      assert.equal((await read())?.name, "Old name");
      assert.deepEqual(events, []);
    });
  });

  describe("Change URL", () => {
    beforeEach(() => {
      editFieldResponse = "url";
    });

    it("prefills the current URL and rejects an invalid one", async () => {
      const { dependencies, events, rebase, target, read } = await createFixture();
      jenkinsUrlInput = "https://user:secret@jenkins.example/";

      await editEnvironment(dependencies, target);

      assert.equal(requiredInputPrefills.get("Jenkins URL"), "https://jenkins.example/");
      assert.equal(errorMessages.length, 1);
      assert.match(errorMessages[0], /without embedded credentials/);
      assert.equal(rebase.mock.calls.length, 0);
      assert.equal((await read())?.url, "https://jenkins.example/");
      assert.deepEqual(events, []);
    });

    it("does nothing when the URL is unchanged", async () => {
      const { dependencies, events, rebase, target } = await createFixture();
      jenkinsUrlInput = "https://jenkins.example";

      await editEnvironment(dependencies, target);

      assert.deepEqual(
        infoMessages.map((entry) => entry.message),
        ["The Jenkins URL is unchanged."]
      );
      assert.equal(rebase.mock.calls.length, 0);
      assert.deepEqual(events, []);
    });

    it("rejects a URL used by another environment in the same scope", async () => {
      const { dependencies, events, rebase, target, read } = await createFixture({
        others: [{ id: "env-2", url: "https://other.example/" }]
      });
      jenkinsUrlInput = "https://other.example";

      await editEnvironment(dependencies, target);

      assert.match(warningMessages[0], /already exists in this scope/);
      assert.equal(rebase.mock.calls.length, 0);
      assert.equal((await read())?.url, "https://jenkins.example/");
      assert.deepEqual(events, []);
    });

    it("saves a path change, rebases, closes panels, and does not offer credentials", async () => {
      const { dependencies, events, target, read } = await createFixture();
      jenkinsUrlInput = "https://jenkins.example/ci";

      await editEnvironment(dependencies, target);

      const environment = await read();
      assert.equal(environment?.url, "https://jenkins.example/ci/");
      assert.deepEqual(environment?.previousUrls, ["https://jenkins.example/"]);
      assert.deepEqual(events, [
        "rebase:workspace:https://jenkins.example/ci/",
        "url-changed:workspace:env-1",
        "invalidate:workspace:env-1",
        "refresh:env-1"
      ]);
      assert.equal(infoMessages.length, 1);
      assert.match(infoMessages[0].message, /now use the new URL/);
      assert.equal(authModePromptCount, 0);
      assert.deepEqual(errorMessages, []);
    });

    it("reports rebase failures and says they will be retried", async () => {
      const { dependencies, rebaseFailures, target, read } = await createFixture();
      rebaseFailures.push(new Error("pin store failed"));
      jenkinsUrlInput = "https://jenkins.example/ci";

      await editEnvironment(dependencies, target);

      assert.equal((await read())?.url, "https://jenkins.example/ci/");
      assert.equal(errorMessages.length, 1);
      assert.match(errorMessages[0], /pin store failed/);
      assert.match(errorMessages[0], /retried the next time the extension activates/);
      assert.deepEqual(infoMessages, []);
    });

    it.each([
      ["Update", 1],
      ["Keep current", 0],
      [undefined, 0]
    ] as const)(
      "offers credentials when the origin changes (choice: %s)",
      async (choice, expectedAuthPrompts) => {
        const { dependencies, store, target } = await createFixture({
          auth: { type: "bearer", token: "old" }
        });
        jenkinsUrlInput = "https://new.example";
        infoMessageResponse = choice;
        authModeResponse = "none";

        await editEnvironment(dependencies, target);

        const offer = infoMessages.find(
          (entry) => entry.message === "Update credentials for the new URL?"
        );
        assert.deepEqual(offer?.items, ["Update", "Keep current"]);
        assert.equal(authModePromptCount, expectedAuthPrompts);
        assert.deepEqual(
          await store.getAuthConfig("workspace", "env-1"),
          expectedAuthPrompts > 0 ? { type: "none" } : { type: "bearer", token: "old" }
        );
      }
    );
  });

  describe("Update Credentials", () => {
    beforeEach(() => {
      editFieldResponse = "credentials";
    });

    it("prefills the basic username and saves the new credentials", async () => {
      const { dependencies, events, store, target } = await createFixture({
        auth: { type: "basic", username: "alice", token: "old-token" }
      });
      authModeResponse = "basic";
      requiredInputResponses.set("Username", "bob");
      requiredInputResponses.set("API Token", "new-token");

      await editEnvironment(dependencies, target);

      assert.deepEqual(authModePromptCurrents, ["basic"]);
      assert.equal(requiredInputPrefills.get("Username"), "alice");
      assert.deepEqual(await store.getAuthConfig("workspace", "env-1"), {
        type: "basic",
        username: "bob",
        token: "new-token"
      });
      assert.deepEqual(events, ["invalidate:workspace:env-1", "refresh:env-1"]);
    });

    it("does not overwrite credentials changed while prompting", async () => {
      const { dependencies, events, store, target } = await createFixture({
        auth: { type: "bearer", token: "old" }
      });
      onAuthModePrompt = () =>
        store.setAuthConfig("workspace", "env-1", { type: "bearer", token: "elsewhere" });
      authModeResponse = "none";

      await editEnvironment(dependencies, target);

      assert.deepEqual(await store.getAuthConfig("workspace", "env-1"), {
        type: "bearer",
        token: "elsewhere"
      });
      assert.match(warningMessages[0], /changed elsewhere/);
      assert.match(warningMessages[0], /Try again/);
      assert.deepEqual(events, []);
    });

    it("passes the stored SSO login URL and current config to the authenticator", async () => {
      const current = sso("session=old");
      const { dependencies, authenticate, store, target } = await createFixture({ auth: current });
      authModeResponse = "sso";
      browserSsoLoginUrl = "https://login.example/custom";
      authenticate.mockImplementation(async () => sso("session=new"));

      await editEnvironment(dependencies, target);

      assert.deepEqual(browserSsoLoginPrefills, ["https://login.example/custom"]);
      assert.deepEqual(authenticate.mock.calls, [
        [
          {
            environmentUrl: "https://jenkins.example/",
            loginUrl: "https://login.example/custom",
            currentAuthConfig: current,
            reason: "manual"
          }
        ]
      ]);
      assert.deepEqual(await store.getAuthConfig("workspace", "env-1"), sso("session=new"));
    });

    it("moves a stored SSO login URL off a previous environment URL", async () => {
      const current = sso("session=old", "https://old.example/__sso/login");
      const { dependencies, store, target } = await createFixture({
        environment: { previousUrls: ["https://old.example/"] },
        auth: current
      });
      authModeResponse = "sso";
      browserSsoLoginUrl = "https://jenkins.example/__sso/login";
      dependencies.browserSsoAuthenticator.authenticate.mockImplementation(async () =>
        sso("session=new", "https://jenkins.example/__sso/login")
      );

      await editEnvironment(dependencies, target);

      assert.deepEqual(browserSsoLoginPrefills, ["https://jenkins.example/__sso/login"]);
      assert.deepEqual(
        await store.getAuthConfig("workspace", "env-1"),
        sso("session=new", "https://jenkins.example/__sso/login")
      );
    });

    it("clears a legacy username and token when switching away from basic auth", async () => {
      const { dependencies, store, target, read } = await createFixture({
        environment: { username: "legacy-user" }
      });
      await store.setToken("workspace", "env-1", "legacy-token");
      authModeResponse = "bearer";
      requiredInputResponses.set("Bearer Token", "new-token");

      await editEnvironment(dependencies, target);

      assert.deepEqual(await store.getAuthConfig("workspace", "env-1"), {
        type: "bearer",
        token: "new-token"
      });
      assert.equal(await store.getToken("workspace", "env-1"), undefined);
      const environment = await read();
      assert.equal(environment && "username" in environment, false);
    });

    it("prefills a legacy username for basic auth", async () => {
      const { dependencies, target } = await createFixture({
        environment: { username: "legacy-user" }
      });
      authModeResponse = "basic";

      await editEnvironment(dependencies, target);

      assert.equal(requiredInputPrefills.get("Username"), "legacy-user");
    });
  });
});
