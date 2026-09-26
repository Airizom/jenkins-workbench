import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const asExternalUri = vi.fn(async (uri: URL) => uri);
const openExternal = vi.fn(async (_uri: URL) => true);
const showErrorMessage = vi.fn();
vi.doMock("vscode", () => ({
  Uri: { parse: (value: string) => new URL(value) },
  env: { asExternalUri, openExternal },
  window: { showErrorMessage }
}));
const { BrowserSsoAuthenticationService } = await import(
  "../src/services/BrowserSsoAuthenticationService"
);
const request = {
  environmentUrl: "https://jenkins.example",
  loginUrl: "https://login.example/sso"
};

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function send(url: URL, path = `${url.pathname}${url.search}`): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: url.hostname, port: url.port, path, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  asExternalUri.mockImplementation(async (uri) => uri);
  openExternal.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe("BrowserSsoAuthenticationService", () => {
  it("uses the external callback URI and preserves state validation after invalid requests", async () => {
    let local!: URL;
    asExternalUri.mockImplementation(async (uri) => {
      local = uri;
      return new URL("https://forwarded.example/jenkins-workbench/sso/callback?route=1");
    });
    openExternal.mockImplementation(async (uri) => {
      expect(uri.searchParams.get("callback_url")).toBe(
        "https://forwarded.example/jenkins-workbench/sso/callback?route=1"
      );
      expect(await send(local, "//[")).toBe(400);
      expect(await send(local, "/unknown")).toBe(404);
      expect(await send(local)).toBe(400);
      local.searchParams.set("state", "wrong");
      local.searchParams.set("cookie", "session=bad");
      expect(await send(local)).toBe(400);
      local.searchParams.set("state", requiredParam(uri, "state"));
      local.searchParams.set("cookie", "session=valid");
      local.searchParams.set("expires_at", "123456789");
      expect(await send(local)).toBe(200);
      return true;
    });
    expect(await new BrowserSsoAuthenticationService().authenticate(request)).toEqual({
      type: "sso",
      loginUrl: request.loginUrl,
      headers: { Cookie: "session=valid" },
      expiresAt: 123456789
    });
    expect(showErrorMessage).not.toHaveBeenCalled();
    await expect(send(local)).rejects.toThrow();
  });

  it.each(["mapping", "browser throws", "browser refuses"])(
    "closes the callback server when %s fails",
    async (failure) => {
      let local!: URL;
      asExternalUri.mockImplementation(async (uri) => {
        local = uri;
        if (failure === "mapping") throw new Error("forwarding failed");
        return uri;
      });
      openExternal.mockImplementation(async () => {
        if (failure === "browser throws") throw new Error("browser failed");
        return false;
      });
      expect(await new BrowserSsoAuthenticationService().authenticate(request)).toBeUndefined();
      expect(showErrorMessage).toHaveBeenCalledOnce();
      await expect(send(local)).rejects.toThrow();
    }
  );

  it("times out and closes the callback server", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => {
      opened = resolve;
    });
    openExternal.mockImplementation(async () => {
      opened();
      return true;
    });
    const pending = new BrowserSsoAuthenticationService().authenticate(request);
    await ready;
    const local = asExternalUri.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBeUndefined();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Timed out"));
    expect(vi.getTimerCount()).toBe(0);
    await expect(send(local)).rejects.toThrow();
  });

  it("does not open the browser if URI resolution finishes after timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish!: (uri: URL) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    asExternalUri.mockImplementation(() => {
      started();
      return new Promise<URL>((resolve) => {
        finish = resolve;
      });
    });
    const pending = new BrowserSsoAuthenticationService().authenticate(request);
    await ready;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBeUndefined();
    finish(new URL("https://forwarded.example/callback"));
    await Promise.resolve();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports an invalid payload with matching state without an unhandled rejection", async () => {
    openExternal.mockImplementation(async (uri) => {
      const callback = new URL(requiredParam(uri, "callback_url"));
      callback.searchParams.set("state", requiredParam(uri, "state"));
      callback.searchParams.set("headers", Buffer.from("[]").toString("base64url"));
      expect(await send(callback)).toBe(400);
      return true;
    });
    expect(await new BrowserSsoAuthenticationService().authenticate(request)).toBeUndefined();
    expect(showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("payload was invalid"));
  });
});
