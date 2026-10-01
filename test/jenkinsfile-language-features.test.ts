import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { createEventEmitterVscodeMock } from "./helpers/vscodeMocks";

interface Registration {
  kind: string;
  selector: unknown;
  disposed: boolean;
}

const registrations: Registration[] = [];
const register =
  (kind: string) =>
  (selector: unknown): { dispose(): void } => {
    const registration: Registration = { kind, selector, disposed: false };
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
    registerCodeLensProvider: register("codeLens")
  }
}));

const { registerJenkinsfileLanguageFeatures } = await import(
  "../src/extension/JenkinsfileLanguageFeatures"
);
const { JenkinsfileMatcher } = await import("../src/validation/JenkinsfileMatcher");

const providers = {
  quickFix: {},
  hover: {},
  completion: {},
  signatureHelp: {},
  codeLens: {}
} as unknown as Parameters<typeof registerJenkinsfileLanguageFeatures>[1];

function active(): Registration[] {
  return registrations.filter((registration) => !registration.disposed);
}

describe("registerJenkinsfileLanguageFeatures", () => {
  it("scopes providers to Jenkinsfile patterns and follows pattern changes", () => {
    registrations.length = 0;
    const matcher = new JenkinsfileMatcher(["**/Jenkinsfile"], ["file"]);

    const disposable = registerJenkinsfileLanguageFeatures(matcher, providers);
    assert.deepEqual(
      active().map((registration) => registration.kind),
      ["codeActions", "hover", "completion", "signatureHelp", "codeLens"]
    );
    for (const registration of active()) {
      assert.deepEqual(registration.selector, [{ scheme: "file", pattern: "**/Jenkinsfile" }]);
    }

    matcher.updatePatterns(["**/*.groovy"]);
    assert.equal(active().length, 5);
    assert.deepEqual(active()[0]?.selector, [{ scheme: "file", pattern: "**/*.groovy" }]);

    matcher.updatePatterns([]);
    assert.equal(active().length, 0);

    matcher.updatePatterns(["**/Jenkinsfile"]);
    assert.equal(active().length, 5);
    disposable.dispose();
    assert.equal(active().length, 0);

    matcher.updatePatterns(["**/*.jenkinsfile"]);
    assert.equal(active().length, 0);
  });
});
