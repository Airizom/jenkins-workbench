import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DeclaredEnvironment,
  DeclaredEnvironmentSource
} from "../src/environments/sharing/DeclaredEnvironmentSource";
import type { EnvironmentAuthHint } from "../src/storage/EnvironmentAuthHint";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../src/jenkins/types";
import type { BrowserSsoAuthenticator } from "../src/services/BrowserSsoAuthenticationService";
import type { EnvironmentRecordParticipant } from "../src/storage/EnvironmentRecordParticipant";
import type { EnvironmentScope } from "../src/storage/JenkinsEnvironmentStore";
import { createExtensionContext, createFakeSecretStorage } from "./helpers/storageMocks";
import * as vscodeStub from "./helpers/vscodeStub";

interface MessageCall {
  message: string;
  options?: { modal?: boolean; detail?: string };
  items: string[];
}

const ui = {
  warnings: [] as MessageCall[],
  infos: [] as MessageCall[],
  errors: [] as string[],
  quickPicks: [] as Array<{ items: Array<{ label: string }>; options: unknown }>,
  warningResponse: undefined as string | undefined,
  pickResponse: undefined as ((items: Array<{ label: string }>) => unknown) | undefined,
  executed: [] as unknown[][],
  openedDocuments: [] as string[],
  activeEditor: undefined as unknown
};

function splitMessageArgs(args: unknown[]): Omit<MessageCall, "message"> {
  const [first, ...rest] = args;
  if (first && typeof first === "object") {
    return { options: first as MessageCall["options"], items: rest as string[] };
  }
  return { items: args as string[] };
}

const vscodeMock = {
  ...vscodeStub,
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async (...args: unknown[]) => {
      ui.executed.push(args);
      return undefined;
    }
  },
  window: {
    showWarningMessage: async (message: string, ...args: unknown[]) => {
      ui.warnings.push({ message, ...splitMessageArgs(args) });
      return ui.warningResponse;
    },
    showInformationMessage: async (message: string, ...args: unknown[]) => {
      ui.infos.push({ message, ...splitMessageArgs(args) });
      return undefined;
    },
    showErrorMessage: async (message: string) => {
      ui.errors.push(message);
      return undefined;
    },
    showQuickPick: async (items: Array<{ label: string }>, options: unknown) => {
      ui.quickPicks.push({ items, options });
      return ui.pickResponse?.(items);
    },
    showTextDocument: async (document: { uri: string }) => {
      const editor = createEditor(document);
      ui.activeEditor = editor;
      return editor;
    },
    get activeTextEditor() {
      return ui.activeEditor;
    }
  },
  workspace: {
    workspaceFolders: undefined as unknown,
    workspaceFile: undefined as unknown,
    openTextDocument: async (uri: vscodeStub.Uri) => {
      ui.openedDocuments.push(uri.toString());
      return { uri: uri.toString(), text: SETTINGS_TEXT };
    }
  }
};

const SETTINGS_TEXT = `{
  "jenkinsWorkbench.environments": [
    {
      "id": "other",
      "url": "https://other.example"
    },
    {
      "id": "ci",
      "url": "https://ci.example"
    }
  ]
}`;

function createEditor(document: { uri: string; text?: string }) {
  const text = document.text ?? "";
  return {
    document: {
      uri: document.uri,
      getText: () => text,
      positionAt: (offset: number) => {
        const before = text.slice(0, offset).split("\n");
        return new vscodeStub.Position(before.length - 1, before[before.length - 1].length);
      }
    },
    selection: undefined as unknown,
    revealed: [] as unknown[],
    revealRange(range: unknown) {
      this.revealed.push(range);
    }
  };
}

const prompts = {
  authModeCalls: 0,
  authModeResponse: "basic" as string | undefined,
  inputs: new Map<string, string | undefined>(),
  inputPrompts: [] as string[],
  loginUrlPrompts: 0,
  loginUrlInitialValues: [] as Array<string | undefined>,
  loginUrlResponse: undefined as string | undefined
};

vi.doMock("vscode", () => vscodeMock);
vi.doMock("../src/commands/environment/EnvironmentPrompts", () => ({
  formatAuthModeLabel: (mode: string) => mode,
  promptAuthMode: async () => {
    prompts.authModeCalls += 1;
    return prompts.authModeResponse;
  },
  promptRequiredInput: async (prompt: string) => {
    prompts.inputPrompts.push(prompt);
    return prompts.inputs.get(prompt);
  },
  promptBrowserSsoLoginUrl: async (_environmentUrl: string, initialValue?: string) => {
    prompts.loginUrlPrompts += 1;
    prompts.loginUrlInitialValues.push(initialValue);
    return prompts.loginUrlResponse;
  },
  promptHeadersJson: async () => undefined,
  promptScope: async () => "workspace",
  promptEnvironmentName: async () => "",
  promptTlsCertificateValidation: async () => false,
  promptEditField: async () => undefined
}));

const { signInToEnvironment } = await import(
  "../src/commands/environment/EnvironmentSignInCommand"
);
const { addEnvironment, editEnvironment, removeEnvironment, signInWithBrowserSso } = await import(
  "../src/commands/environment/EnvironmentCommandHandlers"
);
const { openEnvironmentDeclaration, showHiddenEnvironments } = await import(
  "../src/commands/environment/DeclaredEnvironmentCommands"
);
const { createDeclaredEnvironmentView, DeclaredEnvironmentRegistry } = await import(
  "../src/environments/sharing/DeclaredEnvironmentRegistry"
);
const { DeclaredEnvironmentStateStore } = await import(
  "../src/environments/sharing/DeclaredEnvironmentStateStore"
);
const { JenkinsEnvironmentStore } = await import("../src/storage/JenkinsEnvironmentStore");

function declared(
  options: {
    url?: string;
    authHint?: EnvironmentAuthHint;
    scope?: EnvironmentScope;
    origin?: DeclaredEnvironment["origin"];
  } = {}
): DeclaredEnvironment {
  const scope = options.scope ?? "workspace";
  return {
    scope,
    slug: "ci",
    id: "settings:ci",
    url: options.url ?? "https://ci.example/",
    name: "CI",
    ...(options.authHint ? { authHint: options.authHint } : {}),
    origin: options.origin ?? { level: scope === "global" ? "user" : "workspace" }
  };
}

function setup(declarations: DeclaredEnvironment[]) {
  let current = declarations;
  const source = {
    getDeclared: (scope: EnvironmentScope) => current.filter((entry) => entry.scope === scope),
    getDeclaration: (scope: EnvironmentScope, id: string) =>
      current.find((entry) => entry.scope === scope && entry.id === id)
  } as unknown as DeclaredEnvironmentSource;
  const context = createExtensionContext({ secrets: createFakeSecretStorage() });
  const state = new DeclaredEnvironmentStateStore(context);
  const store = new JenkinsEnvironmentStore(
    context,
    createDeclaredEnvironmentView({ source, state })
  );
  const authenticate = vi.fn(
    async (request: { loginUrl: string }): Promise<JenkinsAuthConfig | undefined> => ({
      type: "sso",
      loginUrl: request.loginUrl,
      headers: { Cookie: "session=1" }
    })
  );
  const invalidateClient = vi.fn();
  const registry = new DeclaredEnvironmentRegistry({
    source,
    state,
    environmentStore: store,
    clientProvider: { invalidateClient }
  });
  const fullEnvironmentRefresh = vi.fn(() => ({ executed: true }));
  const onEnvironmentRemoved = vi.fn();
  const dependencies = {
    store,
    registry,
    browserSsoAuthenticator: { authenticate } as unknown as BrowserSsoAuthenticator,
    clientProvider: { invalidateClient },
    refreshHost: { fullEnvironmentRefresh, onEnvironmentRemoved }
  };
  return {
    store,
    state,
    registry,
    dependencies,
    authenticate,
    invalidateClient,
    fullEnvironmentRefresh,
    setDeclarations(next: DeclaredEnvironment[]) {
      current = next;
    }
  };
}

const sharedRef: JenkinsEnvironmentRef = {
  environmentId: "settings:ci",
  scope: "workspace",
  url: "https://ci.example/",
  name: "CI"
};

beforeEach(() => {
  ui.warnings.length = 0;
  ui.infos.length = 0;
  ui.errors.length = 0;
  ui.quickPicks.length = 0;
  ui.warningResponse = undefined;
  ui.pickResponse = undefined;
  ui.executed.length = 0;
  ui.openedDocuments.length = 0;
  ui.activeEditor = undefined;
  vscodeMock.workspace.workspaceFolders = undefined;
  vscodeMock.workspace.workspaceFile = undefined;
  prompts.authModeCalls = 0;
  prompts.authModeResponse = "basic";
  prompts.inputs.clear();
  prompts.inputPrompts.length = 0;
  prompts.loginUrlPrompts = 0;
  prompts.loginUrlInitialValues = [];
  prompts.loginUrlResponse = undefined;
});

describe("signInToEnvironment", () => {
  it("only confirms the server for a shared environment without sign-in", async () => {
    const harness = setup([declared({ authHint: { type: "none" } })]);
    ui.warningResponse = "Connect";

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(true);

    expect(ui.warnings).toHaveLength(1);
    expect(ui.warnings[0].message).toBe(
      "Connect to https://ci.example? This shared Jenkins environment comes from workspace settings."
    );
    expect(ui.warnings[0].options?.modal).toBe(true);
    expect(prompts.authModeCalls).toBe(0);
    expect(prompts.inputPrompts).toEqual([]);
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://ci.example"
    );
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
    expect(harness.invalidateClient).toHaveBeenCalledWith("workspace", "settings:ci");
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "settings:ci" });
    expect(ui.infos.map(({ message }) => message)).toEqual([
      "Jenkins Workbench will connect to https://ci.example."
    ]);
  });

  it("changes nothing when the server is not confirmed", async () => {
    const harness = setup([declared({ authHint: { type: "basic" } })]);
    ui.warningResponse = undefined;

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(false);

    expect(prompts.inputPrompts).toEqual([]);
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(harness.fullEnvironmentRefresh).not.toHaveBeenCalled();
  });

  it("asks for the hinted basic credentials without offering other methods", async () => {
    const harness = setup([declared({ authHint: { type: "basic" }, origin: { level: "user" } })]);
    harness.setDeclarations([
      declared({ authHint: { type: "basic" }, scope: "global", origin: { level: "user" } })
    ]);
    ui.warningResponse = "Connect";
    prompts.inputs.set("Username", "alice");
    prompts.inputs.set("API Token", "token-1");
    const ref = { ...sharedRef, scope: "global" as const };

    expect(await signInToEnvironment(harness.dependencies, ref)).toBe(true);

    expect(ui.warnings[0].message).toContain("comes from user settings");
    expect(prompts.authModeCalls).toBe(0);
    expect(prompts.inputPrompts).toEqual(["Username", "API Token"]);
    expect(await harness.store.getAuthConfig("global", "settings:ci")).toEqual({
      type: "basic",
      username: "alice",
      token: "token-1"
    });
    expect(await harness.store.getSignInRequirement("global", "settings:ci")).toBe("none");
    expect(ui.infos.map(({ message }) => message)).toEqual(["Signed in to CI."]);
  });

  it("asks for the hinted bearer token", async () => {
    const harness = setup([declared({ authHint: { type: "bearer" } })]);
    ui.warningResponse = "Connect";
    prompts.inputs.set("Bearer Token", "bearer-1");

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(true);

    expect(prompts.inputPrompts).toEqual(["Bearer Token"]);
    expect(await harness.store.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "bearer-1"
    });
  });

  it("signs in with Browser SSO at the hinted sign-in page", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    ui.warningResponse = "Connect";

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(true);

    expect(prompts.loginUrlPrompts).toBe(0);
    expect(harness.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentUrl: "https://ci.example/",
        loginUrl: "https://sso.example/start",
        reason: "manual"
      })
    );
    expect((await harness.store.getAuthConfig("workspace", "settings:ci"))?.type).toBe("sso");
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("lets the user pick a method when the shared environment has no hint", async () => {
    const harness = setup([declared()]);
    ui.warningResponse = "Connect";
    prompts.authModeResponse = "bearer";
    prompts.inputs.set("Bearer Token", "bearer-1");

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(true);

    expect(prompts.authModeCalls).toBe(1);
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("keeps the server unconfirmed when credentials are cancelled", async () => {
    const harness = setup([declared({ authHint: { type: "bearer" } })]);
    ui.warningResponse = "Connect";

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(false);

    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe(
      "confirm-origin"
    );
  });

  it("warns that stored credentials go to a shared server's new origin", async () => {
    const harness = setup([declared({ authHint: { type: "bearer" } })]);
    await harness.registry.acknowledgeOrigin("workspace", "settings:ci");
    await harness.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "t" });
    harness.setDeclarations([
      declared({ authHint: { type: "bearer" }, url: "https://moved.example/" })
    ]);
    ui.warningResponse = "Connect";

    expect(
      await signInToEnvironment(harness.dependencies, {
        ...sharedRef,
        url: "https://moved.example/"
      })
    ).toBe(true);

    expect(ui.warnings[0].message).toBe(
      "CI now points to https://moved.example instead of https://ci.example. Connect to https://moved.example?"
    );
    expect(ui.warnings[0].options?.detail).toContain(
      "Your stored credentials for this environment will be sent to https://moved.example."
    );
    expect(prompts.inputPrompts).toEqual([]);
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://moved.example"
    );
  });

  it("asks for credentials without a confirmation for a stored environment", async () => {
    const harness = setup([]);
    await harness.store.addEnvironment("global", {
      id: "env-1",
      url: "https://jenkins.example/",
      authHint: { type: "bearer" }
    });
    prompts.inputs.set("Bearer Token", "bearer-1");

    expect(
      await signInToEnvironment(harness.dependencies, {
        environmentId: "env-1",
        scope: "global",
        url: "https://jenkins.example/"
      })
    ).toBe(true);

    expect(ui.warnings).toEqual([]);
    expect(await harness.store.getSignInRequirement("global", "env-1")).toBe("none");
  });

  it("only prefills a stored environment's hinted SSO sign-in page for review", async () => {
    const harness = setup([]);
    // An imported or synced record: its hint never went through a server confirmation.
    await harness.store.addEnvironment("global", {
      id: "env-1",
      url: "https://jenkins.example/",
      authHint: { type: "sso", loginUrl: "https://login.elsewhere.example/start" }
    });
    prompts.loginUrlResponse = "https://jenkins.example/login";

    expect(
      await signInToEnvironment(harness.dependencies, {
        environmentId: "env-1",
        scope: "global",
        url: "https://jenkins.example/"
      })
    ).toBe(true);

    expect(prompts.loginUrlInitialValues).toEqual(["https://login.elsewhere.example/start"]);
    expect(harness.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ loginUrl: "https://jenkins.example/login" })
    );
  });

  it("says when no environment needs sign-in", async () => {
    const harness = setup([]);
    await harness.store.addEnvironment("global", { id: "env-1", url: "https://jenkins.example/" });

    expect(await signInToEnvironment(harness.dependencies)).toBe(false);
    expect(ui.quickPicks).toEqual([]);
    expect(ui.infos[0].message).toMatch(/No Jenkins environment needs you to sign in/);

    expect(
      await signInToEnvironment(harness.dependencies, {
        environmentId: "env-1",
        scope: "global",
        url: "https://jenkins.example/"
      })
    ).toBe(false);
    expect(ui.infos[1].message).toBe("https://jenkins.example/ does not need you to sign in.");
  });

  it("lists only environments that need sign-in in the palette", async () => {
    const harness = setup([declared({ authHint: { type: "none" } })]);
    await harness.store.addEnvironment("global", { id: "env-1", url: "https://jenkins.example/" });
    ui.pickResponse = () => undefined;

    await signInToEnvironment(harness.dependencies);

    expect(ui.quickPicks[0].items.map(({ label }) => label)).toEqual(["CI"]);
  });

  it("routes Browser SSO sign-in for an unconfirmed shared server through confirmation", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    ui.warningResponse = undefined;

    const signedIn = await signInWithBrowserSso(
      harness.dependencies.store,
      harness.dependencies.registry,
      harness.dependencies.browserSsoAuthenticator,
      harness.dependencies.clientProvider as never,
      harness.dependencies.refreshHost,
      sharedRef
    );

    expect(signedIn).toBe(false);
    expect(ui.warnings[0].message).toMatch(/^Connect to https:\/\/ci\.example\?/);
    expect(harness.authenticate).not.toHaveBeenCalled();
  });

  it("confirms the server when Browser SSO signs in to a confirmed-but-signed-out shared environment", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    await harness.registry.acknowledgeOrigin("workspace", "settings:ci");

    const signedIn = await signInWithBrowserSso(
      harness.dependencies.store,
      harness.dependencies.registry,
      harness.dependencies.browserSsoAuthenticator,
      harness.dependencies.clientProvider as never,
      harness.dependencies.refreshHost,
      sharedRef
    );

    expect(signedIn).toBe(true);
    expect(prompts.loginUrlPrompts).toBe(0);
    expect(harness.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ loginUrl: "https://sso.example/start" })
    );
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe("none");
  });

  it("shows a separate SSO sign-in page and records it with the server", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    ui.warningResponse = "Connect";

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(true);

    expect(ui.warnings[0].options?.detail).toContain("Sign-in page: https://sso.example.");
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://ci.example|https://sso.example"
    );
  });

  it("asks again, naming both pages, when the shared sign-in page moves", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    await harness.registry.acknowledgeOrigin("workspace", "settings:ci");
    await harness.store.setAuthConfig("workspace", "settings:ci", {
      type: "sso",
      loginUrl: "https://sso.example/start",
      headers: { Cookie: "a=b" }
    });
    harness.setDeclarations([
      declared({ authHint: { type: "sso", loginUrl: "https://login.evil.example/start" } })
    ]);
    ui.warningResponse = undefined;

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(false);

    expect(ui.warnings[0].message).toBe(
      "CI now signs in at https://login.evil.example instead of https://sso.example. Connect to https://ci.example?"
    );
    expect(ui.warnings[0].options?.detail).toContain("Sign-in page: https://login.evil.example.");
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://ci.example|https://sso.example"
    );
  });

  it("does not use a hinted sign-in page the confirmation did not cover", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    // Confirmed before the declaration named a separate sign-in page.
    await harness.state.acknowledgeOrigin("workspace", "settings:ci", "https://ci.example");
    ui.warningResponse = undefined;

    const signedIn = await signInWithBrowserSso(
      harness.dependencies.store,
      harness.dependencies.registry,
      harness.dependencies.browserSsoAuthenticator,
      harness.dependencies.clientProvider as never,
      harness.dependencies.refreshHost,
      sharedRef
    );

    expect(signedIn).toBe(false);
    expect(ui.warnings[0].options?.detail).toContain("Sign-in page: https://sso.example.");
    expect(harness.authenticate).not.toHaveBeenCalled();
  });

  it("records no confirmation when the declaration changes during sign-in", async () => {
    const harness = setup([
      declared({ authHint: { type: "sso", loginUrl: "https://sso.example/start" } })
    ]);
    ui.warningResponse = "Connect";
    harness.authenticate.mockImplementationOnce(async (request) => {
      harness.setDeclarations([
        declared({ authHint: { type: "sso", loginUrl: "https://other.example/start" } })
      ]);
      return { type: "sso", loginUrl: request.loginUrl, headers: { Cookie: "a=b" } };
    });

    expect(await signInToEnvironment(harness.dependencies, sharedRef)).toBe(false);

    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBeUndefined();
    expect(ui.warnings.at(-1)?.message).toBe(
      "The shared definition of CI changed while signing in. Try again."
    );
    expect(await harness.store.getSignInRequirement("workspace", "settings:ci")).toBe(
      "confirm-origin"
    );
  });
});

describe("editing a shared environment", () => {
  function editDependencies(harness: ReturnType<typeof setup>) {
    return {
      ...harness.dependencies,
      clientProvider: harness.dependencies.clientProvider as never,
      urlRebaseService: { changeUrl: vi.fn() }
    };
  }

  it("offers only sign-in and settings while sign-in is required", async () => {
    const harness = setup([declared({ authHint: { type: "basic" } })]);
    ui.pickResponse = () => undefined;

    await editEnvironment(editDependencies(harness), sharedRef);

    expect(ui.quickPicks[0].items.map(({ label }) => label)).toEqual([
      "Sign In",
      "Open in Settings"
    ]);
  });

  it("offers only credentials and settings once signed in, keeping the confirmation", async () => {
    const harness = setup([declared({ authHint: { type: "bearer" } })]);
    await harness.registry.acknowledgeOrigin("workspace", "settings:ci");
    await harness.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "a" });
    ui.pickResponse = (items) => items.find(({ label }) => label === "Update Credentials");
    prompts.authModeResponse = "bearer";
    prompts.inputs.set("Bearer Token", "b");

    expect(await editEnvironment(editDependencies(harness), sharedRef)).toBe(true);

    expect(ui.quickPicks[0].items.map(({ label }) => label)).toEqual([
      "Update Credentials",
      "Open in Settings"
    ]);
    expect(await harness.store.getAuthConfig("workspace", "settings:ci")).toEqual({
      type: "bearer",
      token: "b"
    });
    expect(harness.registry.getAcknowledgedOrigin("workspace", "settings:ci")).toBe(
      "https://ci.example"
    );
  });

  it("opens the declaring folder settings file at the entry", async () => {
    const folderUri = "file:///work/app";
    const harness = setup([declared({ origin: { level: "folder", folderUri } })]);
    ui.pickResponse = (items) => items.find(({ label }) => label === "Open in Settings");

    // Nothing changed yet, so a diagnostics recovery does not retest.
    expect(await editEnvironment(editDependencies(harness), sharedRef)).toBe(false);

    expect(ui.openedDocuments).toEqual(["file:///work/app/.vscode/settings.json"]);
    const editor = ui.activeEditor as { selection: { start: vscodeStub.Position } };
    expect(editor.selection.start).toEqual(new vscodeStub.Position(7, 6));
  });

  it("opens user settings JSON for a user-level declaration", async () => {
    const harness = setup([declared({ scope: "global" })]);

    expect(
      await openEnvironmentDeclaration(harness.store, harness.registry, {
        ...sharedRef,
        scope: "global"
      })
    ).toBe(false);

    expect(ui.executed).toEqual([
      ["workbench.action.openSettingsJson"],
      // No editor opened in this stub, so it falls back to the Settings UI.
      ["workbench.action.openSettings", "jenkinsWorkbench.environments"]
    ]);
  });

  it("opens .vscode/settings.json of a single-folder workspace", async () => {
    const harness = setup([declared()]);
    vscodeMock.workspace.workspaceFolders = [{ uri: vscodeStub.Uri.parse("file:///work/one") }];

    expect(await openEnvironmentDeclaration(harness.store, harness.registry, sharedRef)).toBe(true);

    expect(ui.openedDocuments).toEqual(["file:///work/one/.vscode/settings.json"]);
  });
});

describe("hiding and showing shared environments", () => {
  function removeWith(harness: ReturnType<typeof setup>, cleanup: Record<string, unknown[]>) {
    const participant = (label: string): EnvironmentRecordParticipant => ({
      label,
      copyEnvironmentRecords: async () => ({ copied: 0, undo: async () => undefined }),
      removeEnvironmentRecords: async (ref) => {
        cleanup[label] = [ref.scope, ref.environmentId];
      }
    });
    return removeEnvironment(
      harness.store,
      harness.registry,
      ["bindings", "presets", "watches", "pins"].map(participant),
      harness.dependencies.clientProvider,
      harness.dependencies.refreshHost,
      sharedRef
    );
  }

  it("hides a shared environment and clears its local data", async () => {
    const harness = setup([declared({ authHint: { type: "bearer" } })]);
    await harness.store.setAuthConfig("workspace", "settings:ci", { type: "bearer", token: "t" });
    ui.warningResponse = "Hide Environment";
    const cleanup: Record<string, unknown[]> = {};

    await removeWith(harness, cleanup);

    expect(ui.warnings[0].message).toBe(
      "Hide the shared Jenkins environment CI? Your stored credentials, pins, watches, parameter presets, diagnostic profile bindings and other local data for it will be removed. It stays in settings; use Show Hidden Environments to restore it."
    );
    expect(ui.warnings[0].items).toEqual(["Hide Environment"]);
    expect(await harness.store.getEnvironments("workspace")).toEqual([]);
    expect(await harness.store.getAuthConfig("workspace", "settings:ci")).toBeUndefined();
    expect(Object.keys(cleanup).sort()).toEqual(["bindings", "pins", "presets", "watches"]);
    expect(cleanup.pins).toEqual(["workspace", "settings:ci"]);
    expect(harness.invalidateClient).toHaveBeenCalledWith("workspace", "settings:ci");
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledWith({ environmentId: "settings:ci" });
    expect(ui.errors).toEqual([]);
  });

  it("keeps a shared environment when hiding is not confirmed", async () => {
    const harness = setup([declared()]);
    await removeWith(harness, {});
    expect(await harness.store.getEnvironments("workspace")).toHaveLength(1);
  });

  it("restores the selected hidden environments", async () => {
    const harness = setup([declared()]);
    await harness.store.addEnvironment("global", { id: "uuid-1", url: "https://manual.example/" });
    await harness.registry.hideDeclaredEnvironment("workspace", "settings:ci");
    await harness.state.hideStored("global", "uuid-1");
    ui.pickResponse = (items) => items.filter(({ label }) => label === "CI");

    expect(await showHiddenEnvironments(harness.registry, harness.dependencies.refreshHost)).toBe(
      1
    );

    const picks = ui.quickPicks[0];
    expect(picks.options).toMatchObject({ canPickMany: true });
    expect(
      picks.items.map((item) => [item.label, (item as { description?: string }).description])
    ).toEqual([
      ["CI", "Workspace • Shared"],
      ["https://manual.example/", "Global • Linked to shared definition"]
    ]);
    expect((await harness.store.getEnvironments("workspace")).map(({ id }) => id)).toEqual([
      "settings:ci"
    ]);
    expect((await harness.registry.listHiddenEnvironments()).map(({ id }) => id)).toEqual([
      "uuid-1"
    ]);
    expect(harness.fullEnvironmentRefresh).toHaveBeenCalledWith();
  });

  it("says when nothing is hidden", async () => {
    const harness = setup([declared()]);

    expect(await showHiddenEnvironments(harness.registry, harness.dependencies.refreshHost)).toBe(
      0
    );

    expect(ui.infos.map(({ message }) => message)).toEqual(["No Jenkins environments are hidden."]);
    expect(ui.quickPicks).toEqual([]);
  });
});

describe("adding an environment that is already shared", () => {
  it("points to the shared environment instead of adding a duplicate", async () => {
    const harness = setup([declared({ scope: "global", origin: { level: "user" } })]);
    prompts.inputs.set("Jenkins URL", "https://ci.example");

    await addEnvironment(
      harness.store,
      harness.dependencies.browserSsoAuthenticator,
      harness.dependencies.refreshHost
    );

    expect(ui.warnings.map(({ message }) => message)).toEqual([
      "CI is already shared for this URL through user settings. Use it instead of adding another environment."
    ]);
    expect(await harness.store.getStoredEnvironments("workspace")).toEqual([]);
  });
});
