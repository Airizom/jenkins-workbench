import { buildAuthHeaders } from "../jenkins/auth";
import type { EnvironmentProbeId } from "../jenkins/client/JenkinsEnvironmentDiagnosticsApi";
import { JenkinsRequestError } from "../jenkins/errors";
import type { JenkinsClient } from "../jenkins/JenkinsClient";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { toJenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../jenkins/types";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { classifyProbeFailure, diagnosticCheck } from "./EnvironmentDiagnosticsClassification";
import type {
  DiagnosticCheck,
  DiagnosticCheckId,
  EnvironmentDiagnosticsReport
} from "./EnvironmentDiagnosticsContracts";
import {
  buildConnectivityCheck,
  classifyProbeOutcome,
  type DiagnosticAuthContext,
  type ProbeOutcome
} from "./EnvironmentDiagnosticsProbeClassification";

type DiagnosticClient = Pick<JenkinsClient, "probeEnvironment">;
interface DiagnosticsDataSource {
  createEnvironmentDiagnosticsClient(environment: JenkinsEnvironmentRef): Promise<DiagnosticClient>;
}
type DiagnosticsStore = Pick<
  JenkinsEnvironmentStore,
  "getEnvironments" | "getAuthConfig" | "getToken"
>;
interface ProbeContext extends DiagnosticAuthContext {
  client: DiagnosticClient;
}
type ReportListener = (report: EnvironmentDiagnosticsReport) => void;

const checkOrder: DiagnosticCheckId[] = [
  "connectivity",
  "authentication",
  "api",
  "queue",
  "nodes",
  "csrf",
  "pipeline"
];
const optionalChecks: EnvironmentProbeId[] = ["queue", "nodes", "csrf", "pipeline"];

function isValidEnvironmentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function secretValues(
  auth: JenkinsAuthConfig | undefined,
  token: string | undefined,
  username?: string
): string[] {
  const built = buildAuthHeaders(auth, { username, token });
  const tokenSecrets = auth?.type === "basic" || auth?.type === "bearer" ? [auth.token] : [];
  const values = [
    built.authHeader,
    ...Object.values(built.headers ?? {}),
    token,
    ...tokenSecrets
  ].filter((value): value is string => Boolean(value));
  return values.flatMap((value) => [
    value,
    value.replace(/^(?:Basic|Bearer)\s+/i, ""),
    ...value.split(";").flatMap((cookie) => {
      const separator = cookie.indexOf("=");
      return separator >= 0 ? [cookie.slice(separator + 1).trim()] : [];
    })
  ]);
}

function hasHttpEvidence(outcome: ProbeOutcome): boolean {
  return (
    "response" in outcome ||
    (outcome.error instanceof JenkinsRequestError && outcome.error.statusCode !== undefined)
  );
}

class EnvironmentDiagnosticRun {
  private readonly startedAt = new Date().toISOString();
  private readonly checks = new Map<DiagnosticCheckId, DiagnosticCheck>();
  private jenkinsVersion?: string;

  constructor(
    private readonly dataService: DiagnosticsDataSource,
    private readonly store: DiagnosticsStore,
    private readonly runId: number,
    private readonly signal: AbortSignal,
    private readonly onUpdate?: ReportListener
  ) {}

  async execute(target: JenkinsEnvironmentRef): Promise<EnvironmentDiagnosticsReport> {
    this.signal.throwIfAborted();
    const ref = await this.resolveEnvironment(target);
    if (!ref) return this.snapshot(true);
    const context = await this.resolveContext(ref);
    if (!context) return this.snapshot(true);
    const [root, identity] = await Promise.all([
      this.probe("api", context),
      this.probe("authentication", context)
    ]);
    this.signal.throwIfAborted();
    if (this.applyInitialResults(ref, context, root, identity)) {
      await this.checkCapabilities(context);
    }
    this.signal.throwIfAborted();
    return this.snapshot(true);
  }

  private snapshot(completed = false): EnvironmentDiagnosticsReport {
    return {
      runId: this.runId,
      startedAt: this.startedAt,
      ...(completed ? { completedAt: new Date().toISOString() } : {}),
      checks: checkOrder.flatMap((id) => {
        const check = this.checks.get(id);
        return check
          ? [
              {
                ...check,
                actions: [...check.actions],
                evidence: check.evidence ? [...check.evidence] : undefined
              }
            ]
          : [];
      }),
      ...(this.jenkinsVersion ? { jenkinsVersion: this.jenkinsVersion } : {})
    };
  }

  private publish(check: DiagnosticCheck): void {
    this.signal.throwIfAborted();
    this.checks.set(check.id, check);
    this.onUpdate?.(this.snapshot());
  }

  private skipRemaining(summary: string): void {
    for (const id of checkOrder) {
      if (!this.checks.has(id))
        this.checks.set(id, diagnosticCheck(id, "skipped", "dependency", summary));
    }
  }

  private async resolveEnvironment(
    target: JenkinsEnvironmentRef
  ): Promise<JenkinsEnvironmentRef | undefined> {
    const environment = (await this.store.getEnvironments(target.scope)).find(
      (entry) => entry.id === target.environmentId
    );
    this.signal.throwIfAborted();
    if (!environment) {
      this.publish(
        diagnosticCheck("connectivity", "failed", "removed", "The environment no longer exists.")
      );
      this.skipRemaining("The environment was removed.");
      return undefined;
    }
    const ref = toJenkinsEnvironmentRef({ ...environment, scope: target.scope });
    if (!isValidEnvironmentUrl(ref.url)) {
      this.publish(
        diagnosticCheck(
          "connectivity",
          "failed",
          "invalidUrl",
          "The Jenkins URL is invalid or unsafe.",
          ["editUrl"],
          "Use an HTTP or HTTPS Jenkins base URL without embedded credentials, query parameters, or fragments."
        )
      );
      this.skipRemaining("Correct the Jenkins URL before testing.");
      return undefined;
    }
    return ref;
  }

  private async resolveContext(ref: JenkinsEnvironmentRef): Promise<ProbeContext | undefined> {
    try {
      const auth = await this.store.getAuthConfig(ref.scope, ref.environmentId);
      const token = auth ? undefined : await this.store.getToken(ref.scope, ref.environmentId);
      const client = await this.dataService.createEnvironmentDiagnosticsClient(ref);
      this.signal.throwIfAborted();
      return {
        client,
        sso: auth?.type === "sso",
        hasCredentials: auth ? auth.type !== "none" : Boolean(token),
        secrets: secretValues(auth, token, ref.username)
      };
    } catch (error) {
      this.rethrowCancellation(error);
      this.publish(
        diagnosticCheck(
          "authentication",
          "unavailable",
          "credentialsUnavailable",
          "Saved authentication settings could not be read.",
          ["editCredentials", "retry"]
        )
      );
      this.skipRemaining("Authentication settings could not be loaded.");
      return undefined;
    }
  }

  private rethrowCancellation(error: unknown): void {
    this.signal.throwIfAborted();
    if (isAbort(error)) throw error;
  }

  private captureVersion(value: string | undefined, secrets: string[]): void {
    if (!value || !/^\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.]+)?$/.test(value)) return;
    if (secrets.some((secret) => secret.length > 0 && value.includes(secret))) return;
    this.jenkinsVersion ??= value;
  }

  private async probe(id: EnvironmentProbeId, context: ProbeContext): Promise<ProbeOutcome> {
    this.signal.throwIfAborted();
    try {
      const response = await context.client.probeEnvironment(id, this.signal);
      this.signal.throwIfAborted();
      this.captureVersion(response.jenkinsVersion, context.secrets);
      return { response };
    } catch (error) {
      this.rethrowCancellation(error);
      return { error };
    }
  }

  private applyInitialResults(
    ref: JenkinsEnvironmentRef,
    context: ProbeContext,
    root: ProbeOutcome,
    identity: ProbeOutcome
  ): boolean {
    if (![root, identity].some(hasHttpEvidence)) {
      const failed = classifyProbeFailure(
        "api",
        "error" in root ? root.error : undefined,
        context.sso
      );
      this.publish({
        ...failed,
        id: "connectivity",
        label: "Connectivity and TLS",
        status: "failed"
      });
      this.skipRemaining("The server could not be reached with the saved connection settings.");
      return false;
    }
    this.publish(buildConnectivityCheck(ref));
    const apiCheck = classifyProbeOutcome("api", root, context);
    const authCheck = classifyProbeOutcome("authentication", identity, context);
    this.publish(authCheck);
    this.publish(apiCheck);
    if (
      authCheck.status === "failed" &&
      ["authenticationRequired", "loginRedirect"].includes(authCheck.code)
    ) {
      this.skipRemaining("Sign in or correct authentication before checking capabilities.");
      return false;
    }
    if (
      apiCheck.status === "passed" ||
      authCheck.status === "passed" ||
      authCheck.code === "anonymous" ||
      this.jenkinsVersion
    )
      return true;
    this.skipRemaining(
      "Jenkins could not be identified from the initial responses. Check the base URL and API access first."
    );
    return false;
  }

  private async checkCapabilities(context: ProbeContext): Promise<void> {
    // Two workers share a fixed queue, keeping at most two requests in flight.
    const pending = [...optionalChecks];
    await Promise.all(
      [0, 1].map(async () => {
        for (;;) {
          this.signal.throwIfAborted();
          const id = pending.shift();
          if (!id) return;
          this.publish(classifyProbeOutcome(id, await this.probe(id, context), context));
        }
      })
    );
  }
}

export class EnvironmentDiagnosticsService {
  constructor(
    private readonly dataService: DiagnosticsDataSource,
    private readonly store: DiagnosticsStore
  ) {}

  async run(
    target: JenkinsEnvironmentRef,
    runId: number,
    signal: AbortSignal,
    onUpdate?: ReportListener
  ): Promise<EnvironmentDiagnosticsReport> {
    return new EnvironmentDiagnosticRun(
      this.dataService,
      this.store,
      runId,
      signal,
      onUpdate
    ).execute(target);
  }
}
