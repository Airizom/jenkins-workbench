import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsfileValidationRunner } from "../src/validation/JenkinsfileValidationRunner";
import type { ValidationReason } from "../src/validation/JenkinsfileValidationCoordinatorTypes";

interface ResolverCalls {
  prompt: number;
  silent: number;
}

describe("JenkinsfileValidationRunner environment resolution", () => {
  for (const reason of ["open", "save", "change"] as const) {
    it(`uses silent environment resolution for ${reason} validation`, async () => {
      const calls: ResolverCalls = { prompt: 0, silent: 0 };
      const runner = createRunner(calls);

      const outcome = await runner.run(createDocument(), { reason }, createCallbacks());

      assert.deepEqual(outcome, { status: "completed", kind: "no-environment" });
      assert.equal(calls.prompt, 0);
      assert.equal(calls.silent, 1);
    });
  }

  it("allows environment prompts for command validation", async () => {
    const calls: ResolverCalls = { prompt: 0, silent: 0 };
    const runner = createRunner(calls);

    const outcome = await runner.run(createDocument(), { reason: "command" }, createCallbacks());

    assert.deepEqual(outcome, { status: "completed", kind: "no-environment" });
    assert.equal(calls.prompt, 1);
    assert.equal(calls.silent, 0);
  });
});

function createRunner(calls: ResolverCalls): JenkinsfileValidationRunner {
  const stateStore = {
    getCachedValidation: () => undefined,
    nextToken: () => ({ key: "file:///workspace/Jenkinsfile", token: 1 }),
    isActiveToken: () => true,
    clearCachedValidation: () => undefined,
    canReuseCachedResult: () => false
  };
  const environmentResolver = {
    resolveForDocument: async () => {
      calls.prompt += 1;
      return undefined;
    },
    resolveForDocumentSilently: async () => {
      calls.silent += 1;
      return undefined;
    }
  };
  const logger = {
    logNoEnvironment: (_document: unknown, _reason: ValidationReason) => undefined,
    logValidation: () => undefined
  };
  const clientProvider = {
    getClient: async () => {
      throw new Error("No Jenkins client should be requested without an environment.");
    }
  };

  return new JenkinsfileValidationRunner(
    clientProvider as never,
    environmentResolver as never,
    stateStore as never,
    logger as never
  );
}

function createDocument() {
  return {
    uri: {
      fsPath: "/workspace/Jenkinsfile",
      toString: () => "file:///workspace/Jenkinsfile"
    },
    isClosed: false,
    getText: () => "pipeline { agent any }"
  } as never;
}

function createCallbacks() {
  return {
    onValidationStart: () => undefined,
    onEnvironmentResolved: () => undefined,
    onRestoreStatus: () => undefined
  };
}
