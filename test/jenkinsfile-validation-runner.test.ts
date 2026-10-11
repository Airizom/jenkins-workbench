import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
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

  it.each(["open", "save", "change", "command"] as const)(
    "restores status and returns a controlled resolution failure for %s validation",
    async (reason) => {
      const runner = createRunner({ prompt: 0, silent: 0 }, async () => {
        throw new Error("Selection could not be saved");
      });
      const callbacks = {
        onValidationStart: vi.fn(),
        onEnvironmentResolved: vi.fn(),
        onRestoreStatus: vi.fn()
      };
      const dispose = vi.fn();

      const outcome = await runner.run(
        createDocument(),
        {
          reason,
          cancellationToken: {
            isCancellationRequested: false,
            onCancellationRequested: () => ({ dispose })
          }
        },
        callbacks
      );

      assert.deepEqual(outcome, {
        status: "completed",
        kind: "request-failed",
        environment: undefined,
        message: "Environment resolution failed: Selection could not be saved"
      });
      assert.equal(callbacks.onValidationStart.mock.calls.length, 1);
      assert.equal(callbacks.onEnvironmentResolved.mock.calls.length, 0);
      assert.equal(callbacks.onRestoreStatus.mock.calls.length, 1);
      assert.equal(dispose.mock.calls.length, 1);
    }
  );

  it("ignores a resolution failure after a newer validation starts", async () => {
    let active = true;
    const runner = createRunner(
      { prompt: 0, silent: 0 },
      async () => {
        active = false;
        throw new Error("Selection could not be saved");
      },
      () => active
    );
    const callbacks = { ...createCallbacks(), onRestoreStatus: vi.fn() };

    const outcome = await runner.run(createDocument(), { reason: "save" }, callbacks);

    assert.deepEqual(outcome, { status: "skipped", reason: "inactive" });
    assert.equal(callbacks.onRestoreStatus.mock.calls.length, 0);
  });

  it("preserves the resolved environment on a request failure", async () => {
    const environment: JenkinsEnvironmentRef = {
      environmentId: "env",
      scope: "workspace",
      url: "https://jenkins.example/"
    };
    const runner = createRunner({ prompt: 0, silent: 0 }, async () => environment);

    const outcome = await runner.run(createDocument(), { reason: "save" }, createCallbacks());

    assert.deepEqual(outcome, {
      status: "completed",
      kind: "request-failed",
      environment,
      message: "Validation request failed: Client unavailable"
    });
  });

  it("preserves cancellation when environment resolution rejects", async () => {
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => undefined })
    };
    const runner = createRunner({ prompt: 0, silent: 0 }, async () => {
      cancellationToken.isCancellationRequested = true;
      throw new Error("Selection could not be saved");
    });
    const callbacks = { ...createCallbacks(), onRestoreStatus: vi.fn() };

    const outcome = await runner.run(
      createDocument(),
      { reason: "save", cancellationToken },
      callbacks
    );

    assert.deepEqual(outcome, { status: "canceled" });
    assert.equal(callbacks.onRestoreStatus.mock.calls.length, 1);
  });
});

function createRunner(
  calls: ResolverCalls,
  resolve: () => Promise<JenkinsEnvironmentRef | undefined> = async () => undefined,
  isActiveToken = () => true
): JenkinsfileValidationRunner {
  const stateStore = {
    getCachedValidation: () => undefined,
    nextToken: () => ({ key: "file:///workspace/Jenkinsfile", token: 1 }),
    isActiveToken,
    clearCachedValidation: () => undefined,
    canReuseCachedResult: () => false
  };
  const environmentResolver = {
    resolveForDocument: async () => {
      calls.prompt += 1;
      return resolve();
    },
    resolveForDocumentSilently: async () => {
      calls.silent += 1;
      return resolve();
    }
  };
  const logger = {
    logNoEnvironment: (_document: unknown, _reason: ValidationReason) => undefined,
    logValidation: () => undefined
  };
  const clientProvider = {
    getClient: async () => {
      throw new Error("Client unavailable");
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
