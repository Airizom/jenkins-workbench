import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

interface Registration {
  kind: string;
  selector: unknown;
  provider: unknown;
  disposed: boolean;
  extra: unknown[];
}

const registrations: Registration[] = [];
const register =
  (kind: string) =>
  (selector: unknown, provider: unknown, ...rest: unknown[]): { dispose(): void } => {
    const registration: Registration = { kind, selector, provider, disposed: false, extra: rest };
    registrations.push(registration);
    return {
      dispose: () => {
        registration.disposed = true;
      }
    };
  };

vi.doMock("vscode", () => ({
  ...createEventEmitterVscodeMock(),
  CodeActionKind: { QuickFix: "quickfix" },
  Disposable: class {
    constructor(private readonly callback: () => void) {}
    dispose(): void {
      this.callback();
    }
  },
  languages: {
    registerCodeActionsProvider: register("codeActions"),
    registerHoverProvider: register("hover"),
    registerCompletionItemProvider: register("completion"),
    registerSignatureHelpProvider: register("signatureHelp"),
    registerCodeLensProvider: register("codeLens"),
    registerDocumentSymbolProvider: register("documentSymbol"),
    registerDefinitionProvider: register("definition")
  }
}));

const { registerJenkinsfileLanguageFeatures } = await import(
  "../src/extension/JenkinsfileLanguageFeatures"
);
const { JenkinsfileMatcher } = await import("../src/validation/JenkinsfileMatcher");

const providers = {
  quickFix: {},
  hover: {},
  intelligenceHover: {},
  completion: {},
  signatureHelp: {},
  codeLens: {},
  documentSymbol: {},
  definition: {}
} as unknown as Parameters<typeof registerJenkinsfileLanguageFeatures>[1];

function active(): Registration[] {
  return registrations.filter((registration) => !registration.disposed);
}

const VARS_SELECTOR = [{ scheme: "file", pattern: "**/vars/*.groovy" }];
const JENKINSFILE_KINDS = [
  "codeActions",
  "hover",
  "completion",
  "signatureHelp",
  "definition",
  "codeLens",
  "documentSymbol"
];
const VARS_KINDS = ["hover", "completion", "signatureHelp", "definition"];

function activeJenkinsfile(): Registration[] {
  return active().filter(
    (registration) => JSON.stringify(registration.selector) !== JSON.stringify(VARS_SELECTOR)
  );
}

function activeVars(): Registration[] {
  return active().filter(
    (registration) => JSON.stringify(registration.selector) === JSON.stringify(VARS_SELECTOR)
  );
}

describe("registerJenkinsfileLanguageFeatures", () => {
  it("scopes providers to Jenkinsfile patterns and follows pattern changes", () => {
    registrations.length = 0;
    const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);

    const disposable = registerJenkinsfileLanguageFeatures(matcher, providers);
    assert.deepEqual(
      activeJenkinsfile().map((registration) => registration.kind),
      JENKINSFILE_KINDS
    );
    for (const registration of activeJenkinsfile()) {
      assert.deepEqual(registration.selector, [{ scheme: "file", pattern: "**/Jenkinsfile" }]);
    }

    matcher.updatePatterns(["**/*.groovy"]);
    assert.equal(activeJenkinsfile().length, JENKINSFILE_KINDS.length);
    assert.deepEqual(activeJenkinsfile()[0]?.selector, [
      { scheme: "file", pattern: "**/*.groovy" }
    ]);

    matcher.updatePatterns([]);
    assert.equal(activeJenkinsfile().length, 0);

    matcher.updatePatterns(["**/Jenkinsfile"]);
    assert.equal(activeJenkinsfile().length, JENKINSFILE_KINDS.length);
    disposable.dispose();
    assert.equal(active().length, 0);

    matcher.updatePatterns(["**/*.jenkinsfile"]);
    assert.equal(active().length, 0);
  });

  it("registers only intelligence providers for shared library vars files", () => {
    registrations.length = 0;
    const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);

    const disposable = registerJenkinsfileLanguageFeatures(matcher, providers);
    assert.deepEqual(
      activeVars().map((registration) => registration.kind),
      VARS_KINDS
    );

    matcher.updatePatterns([]);
    assert.deepEqual(
      activeVars().map((registration) => registration.kind),
      VARS_KINDS
    );

    disposable.dispose();
    assert.equal(activeVars().length, 0);
  });

  it("opens completion on member access and library-name quotes", () => {
    registrations.length = 0;
    const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);

    const disposable = registerJenkinsfileLanguageFeatures(matcher, providers);
    for (const registration of active().filter((entry) => entry.kind === "completion")) {
      assert.deepEqual(registration.extra, [".", "'", '"']);
    }
    disposable.dispose();
  });

  it("leaves vars files that the Jenkinsfile patterns also match to the Jenkinsfile providers", async () => {
    registrations.length = 0;
    const calls: string[] = [];
    const answering = {
      quickFix: {},
      codeLens: {},
      documentSymbol: {},
      hover: { provideHover: () => calls.push("hover") && "hover" },
      intelligenceHover: {
        provideHover: () => calls.push("intelligenceHover") && "intelligenceHover"
      },
      completion: { provideCompletionItems: () => calls.push("completion") && "completion" },
      signatureHelp: { provideSignatureHelp: () => calls.push("signatureHelp") && "signature" },
      definition: { provideDefinition: () => calls.push("definition") && "definition" }
    } as unknown as Parameters<typeof registerJenkinsfileLanguageFeatures>[1];
    let groovyIsJenkinsfile = true;
    const matcher = {
      documentSelector: [{ scheme: "file", pattern: "**/*.groovy" }],
      onDidChangeSelector: () => ({ dispose: () => {} }),
      matches: () => groovyIsJenkinsfile
    } as unknown as InstanceType<typeof JenkinsfileMatcher>;

    const disposable = registerJenkinsfileLanguageFeatures(matcher, answering);
    const varsFile = { uri: { scheme: "file", path: "/lib/vars/deploy.groovy" } };
    const invoke = (registration: Registration): unknown => {
      const provider = registration.provider as Record<string, (...args: unknown[]) => unknown>;
      const method = Object.keys(provider).find((key) => key.startsWith("provide"));
      assert.ok(method);
      return provider[method](varsFile, { line: 0, character: 0 }, {}, {});
    };

    for (const registration of activeVars()) {
      assert.equal(await invoke(registration), undefined, registration.kind);
    }
    assert.deepEqual(calls, []);
    for (const registration of activeJenkinsfile().filter((entry) =>
      VARS_KINDS.includes(entry.kind)
    )) {
      assert.notEqual(await invoke(registration), undefined, registration.kind);
    }
    assert.deepEqual(calls, VARS_KINDS);

    // Vars files outside the Jenkinsfile patterns are served by the vars registration, whose
    // hover is the intelligence-only composite (never validation).
    calls.length = 0;
    groovyIsJenkinsfile = false;
    for (const registration of activeVars()) {
      assert.notEqual(await invoke(registration), undefined, registration.kind);
    }
    assert.deepEqual(calls, ["intelligenceHover", "completion", "signatureHelp", "definition"]);
    const varsHover = activeVars().find((registration) => registration.kind === "hover");
    assert.equal(await invoke(varsHover as Registration), "intelligenceHover");
    disposable.dispose();
  });
});
