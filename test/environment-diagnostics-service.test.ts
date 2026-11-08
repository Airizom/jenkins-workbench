import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { EnvironmentDiagnosticsReport } from "../src/environmentDiagnostics/EnvironmentDiagnosticsContracts";
import { formatEnvironmentDiagnosticsReport } from "../src/environmentDiagnostics/EnvironmentDiagnosticsReport";
import { EnvironmentDiagnosticsService } from "../src/environmentDiagnostics/EnvironmentDiagnosticsService";
import type {
  EnvironmentProbeId,
  EnvironmentProbeResponse
} from "../src/jenkins/client/JenkinsEnvironmentDiagnosticsApi";
import { JenkinsMaxBytesError, JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsAuthConfig } from "../src/jenkins/types";

const environment = { id: "env", url: "https://jenkins.example/jenkins/", name: "Test Jenkins" };
const ref = { environmentId: "env", scope: "global" as const, url: environment.url };
const responses: Record<EnvironmentProbeId, string> = {
  api: JSON.stringify({ jobs: [], views: [] }),
  authentication: JSON.stringify({ authenticated: true, anonymous: false, name: "developer" }),
  queue: JSON.stringify({ items: [] }),
  nodes: JSON.stringify({ computer: [] }),
  csrf: JSON.stringify({ crumbRequestField: "Jenkins-Crumb", crumb: "private-crumb" }),
  pipeline: "def ctx = context(scope: scriptScope()); contributor(ctx) {}"
};

function response(text: string, statusCode = 200): EnvironmentProbeResponse {
  return { statusCode, text, jenkinsVersion: "2.479.1" };
}

function setup(
  options: {
    auth?: JenkinsAuthConfig;
    token?: string;
    probe?: (id: EnvironmentProbeId, signal: AbortSignal) => Promise<EnvironmentProbeResponse>;
    url?: string;
    removed?: boolean;
    allowInsecureTls?: boolean;
  } = {}
) {
  const store = {
    getEnvironments: vi.fn(async () =>
      options.removed
        ? []
        : [
            {
              ...environment,
              url: options.url ?? environment.url,
              allowInsecureTls: options.allowInsecureTls
            }
          ]
    ),
    getAuthConfig: vi.fn(async () => options.auth ?? { type: "none" as const }),
    getToken: vi.fn(async () => options.token)
  };
  const probe = vi.fn(options.probe ?? (async (id: EnvironmentProbeId) => response(responses[id])));
  const dataService = {
    createEnvironmentDiagnosticsClient: vi.fn(async (_environment: JenkinsEnvironmentRef) => ({
      probeEnvironment: probe
    }))
  };
  return {
    service: new EnvironmentDiagnosticsService(dataService, store),
    dataService,
    store,
    probe
  };
}

async function run(options: Parameters<typeof setup>[0] = {}) {
  const fixture = setup(options);
  const controller = new AbortController();
  const updates: EnvironmentDiagnosticsReport[] = [];
  const report = await fixture.service.run(ref, 7, controller.signal, (update) =>
    updates.push(update)
  );
  return { ...fixture, report, updates };
}

describe("environment diagnostics", () => {
  it("verifies an empty Jenkins instance and publishes independent immutable snapshots", async () => {
    const { report, probe, updates } = await run();
    assert.equal(report.runId, 7);
    assert.equal(report.jenkinsVersion, "2.479.1");
    assert.ok(report.completedAt);
    assert.equal(report.checks.length, 7);
    assert.ok(report.checks.every((check) => check.status === "passed"));
    assert.equal(probe.mock.calls.length, 6);
    assert.equal(updates[0].checks.length, 1);
    assert.equal(updates.at(-1)?.checks.length, 7);
    assert.notStrictEqual(updates[0].checks, report.checks);
    assert.match(report.checks[1].summary, /developer/);
    assert.match(report.checks[5].detail, /does not verify build-trigger/);
  });

  it.each([false, true])(
    "distinguishes configured anonymous access from ignored credentials: %s",
    async (configured) => {
      const { report } = await run({
        auth: configured
          ? { type: "basic", username: "user", token: "private-token" }
          : { type: "none" },
        probe: async (id) =>
          response(
            id === "authentication"
              ? '{"authenticated":false,"anonymous":true,"name":"anonymous"}'
              : responses[id]
          )
      });
      const auth = report.checks.find((check) => check.id === "authentication");
      assert.equal(auth?.status, configured ? "warning" : "passed");
      assert.equal(auth?.code, "anonymous");
      assert.equal(report.checks.find((check) => check.id === "api")?.status, "passed");
    }
  );

  it("uses saved environment URL and TLS settings rather than stale references", async () => {
    const { report, dataService } = await run({
      url: "https://new.example/context/",
      allowInsecureTls: true
    });
    assert.equal(
      dataService.createEnvironmentDiagnosticsClient.mock.calls[0]?.[0]?.url,
      "https://new.example/context/"
    );
    assert.equal(report.checks[0].status, "warning");
    assert.equal(report.checks[0].code, "tlsVerificationDisabled");
  });

  it.each([
    ["ENOTFOUND", "dns"],
    ["EAI_AGAIN", "dns"],
    ["ECONNREFUSED", "connectionRefused"],
    ["ETIMEDOUT", "timeout"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "certificate"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "certificate"],
    ["ECONNRESET", "transport"]
  ])("classifies transport failure %s without copying raw errors", async (code, expected) => {
    const { report, probe } = await run({
      probe: async () => {
        throw Object.assign(new Error("SECRET_RAW_ERROR"), { code });
      }
    });
    assert.equal(report.checks[0].status, "failed");
    assert.equal(report.checks[0].code, expected);
    assert.ok(report.checks.slice(1).every((check) => check.status === "skipped"));
    assert.equal(probe.mock.calls.length, 2);
    assert.ok(!JSON.stringify(report).includes("SECRET_RAW_ERROR"));
  });

  it("treats HTTP 401 as connectivity evidence and stops dependent checks", async () => {
    const { report, probe } = await run({
      auth: {
        type: "sso",
        loginUrl: "https://jenkins.example/login",
        headers: { Cookie: "session-private" }
      },
      probe: async () => response("session-private", 401)
    });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[1].status, "failed");
    assert.ok(report.checks[1].actions.includes("signIn"));
    assert.equal(probe.mock.calls.length, 2);
    assert.ok(report.checks.slice(3).every((check) => check.status === "skipped"));
    assert.ok(!JSON.stringify(report).includes("session-private"));
  });

  it("does not mistake API permission denial for rejected authentication", async () => {
    const { report, probe } = await run({
      probe: async (id) => response(responses[id], id === "api" ? 403 : 200)
    });
    assert.equal(report.checks[1].status, "passed");
    assert.equal(report.checks[2].status, "unavailable");
    assert.equal(report.checks[2].code, "forbidden");
    assert.equal(probe.mock.calls.length, 6);
  });

  it("keeps all 403 responses uncertain and offers explicit SSO recovery", async () => {
    const { report } = await run({
      auth: { type: "sso", loginUrl: "https://id.example/" },
      probe: async () => response("denied", 403)
    });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[1].status, "unavailable");
    assert.equal(report.checks[1].code, "forbidden");
    assert.ok(report.checks[1].actions.includes("signIn"));
  });

  it("reports login redirects without opening sign-in", async () => {
    const { report, probe } = await run({
      probe: async () => {
        throw new JenkinsRequestError(
          "Jenkins redirected to login. Check credentials or CSRF settings.",
          302
        );
      }
    });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[1].code, "loginRedirect");
    assert.equal(probe.mock.calls.length, 2);
  });

  it("recognizes an HTML login page without copying HTML into the report", async () => {
    const { report } = await run({
      probe: async () =>
        response(
          '<html><form action="j_security_check"><input type="password">SECRET_BODY</form></html>'
        )
    });
    assert.equal(report.checks[1].code, "authenticationRequired");
    assert.ok(!JSON.stringify(report).includes("SECRET_BODY"));
  });

  it.each(["<html>Gateway page</html>", "{bad-json", "{}", "[]"])(
    "does not pass unrecognized root/identity responses: %s",
    async (text) => {
      const { report } = await run({ probe: async () => ({ statusCode: 200, text }) });
      assert.equal(report.checks[0].status, "passed");
      assert.equal(report.checks[1].code, "unexpectedResponse");
      assert.equal(report.checks[2].code, "unexpectedResponse");
      assert.ok(report.checks.slice(3).every((check) => check.status === "skipped"));
    }
  );

  it("does not infer missing plugins from 404 or disabled CSRF from hidden endpoints", async () => {
    const { report } = await run({
      probe: async (id) => response(responses[id], id === "csrf" || id === "pipeline" ? 404 : 200)
    });
    const csrf = report.checks.find((check) => check.id === "csrf");
    const pipeline = report.checks.find((check) => check.id === "pipeline");
    assert.equal(csrf?.status, "unavailable");
    assert.match(csrf?.detail ?? "", /may be disabled/);
    assert.equal(pipeline?.status, "unavailable");
    assert.match(pipeline?.detail ?? "", /may not be installed/);
  });

  it.each([404, 500, 429])("reports core HTTP %s accurately", async (statusCode) => {
    const { report } = await run({ probe: async () => response("SECRET_RESPONSE", statusCode) });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[2].code, statusCode === 404 ? "notFound" : "httpError");
    assert.ok(!JSON.stringify(report).includes("SECRET_RESPONSE"));
  });

  it("does not pass oversized responses", async () => {
    const { report } = await run({
      probe: async (id) => {
        if (id === "pipeline") throw new JenkinsMaxBytesError(1024, 200);
        return response(responses[id]);
      }
    });
    assert.equal(report.checks.at(-1)?.code, "responseTooLarge");
    assert.equal(report.checks.at(-1)?.status, "unavailable");
  });

  it("limits simultaneous requests to two and preserves stable result order", async () => {
    let active = 0;
    let peak = 0;
    const { report } = await run({
      probe: async (id) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return response(responses[id]);
      }
    });
    assert.equal(peak, 2);
    assert.deepEqual(
      report.checks.map((check) => check.id),
      ["connectivity", "authentication", "api", "queue", "nodes", "csrf", "pipeline"]
    );
  });

  it("cancels requests without publishing stale findings or scheduling capabilities", async () => {
    const controller = new AbortController();
    const fixture = setup({
      probe: async (_id, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    });
    const updates = vi.fn();
    const pending = fixture.service.run(ref, 1, controller.signal, updates);
    await vi.waitFor(() => assert.equal(fixture.probe.mock.calls.length, 2));
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(updates.mock.calls.length, 0);
    assert.equal(fixture.probe.mock.calls.length, 2);
  });

  it.each([
    "not a URL",
    "https://user:secret@example/",
    "https://example/?secret=token",
    "file:///tmp/jenkins"
  ])("rejects unsafe stored URL %s before sending credentials", async (url) => {
    const { report, probe } = await run({ url });
    assert.equal(report.checks[0].code, "invalidUrl");
    assert.equal(probe.mock.calls.length, 0);
  });

  it("handles removed environments without requests", async () => {
    const { report, probe } = await run({ removed: true });
    assert.equal(report.checks[0].code, "removed");
    assert.equal(probe.mock.calls.length, 0);
  });

  it.each([
    [{ type: "basic", username: "foo", token: "ab" }, "Zm9vOmFi"],
    [{ type: "basic", username: "foo", token: "secret-basic-token" }, "secret-basic-token"],
    [{ type: "headers", headers: { Authorization: "Bearer private-token" } }, "private-token"],
    [
      { type: "cookie", cookie: "JSESSIONID=private-session; other=other-private" },
      "private-session"
    ],
    [
      {
        type: "sso",
        loginUrl: "https://id.example/",
        headers: { Cookie: "session=private-session" }
      },
      "private-session"
    ]
  ] satisfies [JenkinsAuthConfig, string][])(
    "omits derived credential material from echoed identities: %j",
    async (auth, echoed) => {
      const { report } = await run({
        auth,
        probe: async (id) =>
          response(
            id === "authentication"
              ? JSON.stringify({ authenticated: true, anonymous: false, name: echoed })
              : responses[id]
          )
      });
      assert.ok(!JSON.stringify(report).includes(echoed));
      assert.equal(report.checks[1].status, "passed");
    }
  );

  it("omits credentials echoed as a version and prioritizes anonymous identity", async () => {
    const { report } = await run({
      auth: { type: "bearer", token: "2.479.1" },
      probe: async (id) =>
        response(
          id === "authentication"
            ? '{"authenticated":true,"anonymous":true,"name":"user"}'
            : responses[id]
        )
    });
    assert.equal(report.jenkinsVersion, undefined);
    assert.equal(report.checks[1].code, "anonymous");
    assert.equal(report.checks[1].status, "warning");
  });

  it.each([false, true])(
    "handles Spring anonymous tokens with authenticated=true for configured credentials=%s",
    async (configured) => {
      const { report } = await run({
        auth: configured ? { type: "bearer", token: "private-token" } : { type: "none" },
        probe: async (id) =>
          response(
            id === "authentication"
              ? '{"authenticated":true,"anonymous":true,"name":"anonymous"}'
              : responses[id]
          )
      });
      assert.equal(report.checks[1].code, "anonymous");
      assert.equal(report.checks[1].status, configured ? "warning" : "passed");
    }
  );

  it("reports redirect loops as reachable and offers URL recovery", async () => {
    const { report } = await run({
      probe: async () => {
        throw new JenkinsRequestError("Too many redirects from Jenkins API.", 302);
      }
    });
    assert.equal(report.checks[0].status, "passed");
    assert.equal(report.checks[1].code, "redirect");
    assert.ok(report.checks[1].actions.includes("editUrl"));
  });

  it("labels partial cancelled and running copied reports explicitly", async () => {
    const { report } = await run();
    const partial = { ...report, completedAt: undefined, checks: report.checks.slice(0, 1) };
    const environment = { url: ref.url, scope: ref.scope };
    assert.match(
      formatEnvironmentDiagnosticsReport(partial, { ...environment, state: "cancelled" }),
      /Run state: cancelled/
    );
    assert.match(
      formatEnvironmentDiagnosticsReport(partial, { ...environment, state: "running" }),
      /Run state: running/
    );
    assert.match(formatEnvironmentDiagnosticsReport(partial, environment), /Run state: partial/);
  });

  it("copies allowlisted evidence without tokens, crumb values, or echoed secret identities", async () => {
    const { report } = await run({
      auth: { type: "bearer", token: "private-token" },
      probe: async (id) =>
        response(
          id === "authentication"
            ? '{"authenticated":true,"anonymous":false,"name":"private-token"}'
            : responses[id]
        )
    });
    const copy = formatEnvironmentDiagnosticsReport(report, {
      ...environment,
      scope: "global",
      url: "https://user:password@example/jenkins/?query-secret#hash-secret"
    });
    for (const secret of [
      "private-token",
      "private-crumb",
      "password",
      "query-secret",
      "hash-secret"
    ]) {
      assert.ok(!copy.includes(secret));
      assert.ok(!JSON.stringify(report).includes(secret));
    }
    assert.match(copy, /URL: https:\/\/example\/jenkins\//);
    assert.match(copy, /HTTP 200/);
  });
});
