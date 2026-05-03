import * as crypto from "node:crypto";
import * as http from "node:http";
import * as vscode from "vscode";
import type { JenkinsAuthConfig } from "../jenkins/types";

const CALLBACK_PATH = "/jenkins-workbench/sso/callback";
const AUTH_TIMEOUT_MS = 2 * 60 * 1000;

export interface BrowserSsoAuthenticationRequest {
  environmentUrl: string;
  loginUrl: string;
  currentAuthConfig?: JenkinsAuthConfig;
  reason?: "add" | "reauth" | "manual";
}

export interface BrowserSsoAuthenticator {
  authenticate(request: BrowserSsoAuthenticationRequest): Promise<JenkinsAuthConfig | undefined>;
}

interface CallbackResult {
  state: string;
  headers: Record<string, string>;
  expiresAt?: number;
}

export class BrowserSsoAuthenticationService implements BrowserSsoAuthenticator {
  async authenticate(
    request: BrowserSsoAuthenticationRequest
  ): Promise<JenkinsAuthConfig | undefined> {
    const loginUrl = this.parseHttpUrl(request.loginUrl);
    if (!loginUrl) {
      void vscode.window.showErrorMessage(
        "Browser SSO sign-in URL must be a valid HTTP or HTTPS URL."
      );
      return undefined;
    }

    const callback = await createCallbackServer();
    const state = crypto.randomBytes(24).toString("base64url");
    const signInUrl = this.buildSignInUrl(loginUrl, callback.url, state);
    const timeout = this.createTimeout(callback.server);

    try {
      const opened = await vscode.env.openExternal(vscode.Uri.parse(signInUrl));
      if (!opened) {
        void vscode.window.showErrorMessage("Unable to open the browser SSO sign-in page.");
        callback.server.close();
        return undefined;
      }

      const result = await Promise.race([callback.waitForResult(state), timeout]);
      return {
        type: "sso",
        loginUrl: loginUrl.toString(),
        headers: result.headers,
        expiresAt: result.expiresAt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Browser SSO sign-in failed: ${message}`);
      return undefined;
    } finally {
      callback.server.close();
    }
  }

  private buildSignInUrl(loginUrl: URL, callbackUrl: string, state: string): string {
    const url = new URL(loginUrl.toString());
    url.searchParams.set("callback_url", callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }

  private parseHttpUrl(value: string): URL | undefined {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return undefined;
      }
      return url;
    } catch {
      return undefined;
    }
  }

  private createTimeout(server: http.Server): Promise<CallbackResult> {
    return new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Timed out waiting for browser SSO callback."));
      }, AUTH_TIMEOUT_MS);
      server.once("close", () => clearTimeout(timeout));
    });
  }
}

function createCallbackServer(): Promise<{
  server: http.Server;
  url: string;
  waitForResult(state: string): Promise<CallbackResult>;
}> {
  let resolveResult: ((value: CallbackResult) => void) | undefined;
  let rejectResult: ((reason: Error) => void) | undefined;

  const resultPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== CALLBACK_PATH) {
      writeHtml(response, 404, "Jenkins Workbench SSO", "Unknown browser SSO callback path.");
      return;
    }

    try {
      const result = parseCallbackResult(requestUrl);
      resolveResult?.(result);
      writeHtml(
        response,
        200,
        "Jenkins Workbench SSO",
        "Sign-in is complete. You can close this browser tab."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rejectResult?.(new Error(message));
      writeHtml(response, 400, "Jenkins Workbench SSO", message);
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("Unable to determine browser SSO callback port."));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        waitForResult: async (state) => {
          const result = await resultPromise;
          if (result.state !== state) {
            throw new Error("Browser SSO callback state did not match.");
          }
          return result;
        }
      });
    });
  });
}

function parseCallbackResult(url: URL): CallbackResult {
  const state = url.searchParams.get("state")?.trim();
  if (!state) {
    throw new Error("Browser SSO callback was missing state.");
  }

  const headersParam = url.searchParams.get("headers");
  if (headersParam) {
    const parsed = JSON.parse(Buffer.from(headersParam, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Browser SSO callback headers payload was invalid.");
    }
    const headers = normalizeHeaders(parsed as Record<string, unknown>);
    if (Object.keys(headers).length === 0) {
      throw new Error("Browser SSO callback did not provide any headers.");
    }
    return {
      state,
      headers,
      expiresAt: parseExpiresAt(url.searchParams.get("expires_at"))
    };
  }

  const cookie = url.searchParams.get("cookie")?.trim();
  if (cookie) {
    return {
      state,
      headers: { Cookie: cookie },
      expiresAt: parseExpiresAt(url.searchParams.get("expires_at"))
    };
  }

  const cookieName = url.searchParams.get("cookie_name")?.trim();
  const cookieValue = url.searchParams.get("cookie_value")?.trim();
  if (cookieName && cookieValue) {
    return {
      state,
      headers: { Cookie: `${cookieName}=${cookieValue}` },
      expiresAt: parseExpiresAt(url.searchParams.get("expires_at"))
    };
  }

  throw new Error("Browser SSO callback did not include session headers.");
}

function normalizeHeaders(raw: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (normalizedKey.length > 0 && normalizedValue.length > 0) {
      headers[normalizedKey] = normalizedValue;
    }
  }
  return headers;
}

function parseExpiresAt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function writeHtml(
  response: http.ServerResponse,
  statusCode: number,
  title: string,
  body: string
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8"
  });
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(body)}</p>
  </main>
</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
