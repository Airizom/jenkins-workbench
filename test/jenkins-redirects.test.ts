import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { requestText } from "../src/jenkins/request";
import { isCrossOriginRedirect } from "../src/jenkins/request/redirects";

describe("isCrossOriginRedirect", () => {
  it("treats the same origin as same-origin", () => {
    assert.equal(
      isCrossOriginRedirect("https://jenkins.example.com/job/a/", "https://jenkins.example.com/"),
      false
    );
  });

  it("normalizes default ports", () => {
    assert.equal(
      isCrossOriginRedirect("https://jenkins.example.com:443/", "https://jenkins.example.com/x"),
      false
    );
    assert.equal(
      isCrossOriginRedirect("http://jenkins.example.com:80/", "http://jenkins.example.com/x"),
      false
    );
  });

  it("treats a different host as cross-origin", () => {
    assert.equal(
      isCrossOriginRedirect("https://jenkins.example.com/", "https://evil.example.com/"),
      true
    );
  });

  it("treats a different port as cross-origin", () => {
    assert.equal(
      isCrossOriginRedirect("https://jenkins.example.com/", "https://jenkins.example.com:8443/"),
      true
    );
  });

  it("treats an https to http downgrade on the same host as cross-origin", () => {
    assert.equal(
      isCrossOriginRedirect("https://jenkins.example.com/", "http://jenkins.example.com/"),
      true
    );
  });

  it("treats unparseable URLs as cross-origin", () => {
    assert.equal(isCrossOriginRedirect("not a url", "https://jenkins.example.com/"), true);
    assert.equal(isCrossOriginRedirect("https://jenkins.example.com/", "not a url"), true);
  });
});

interface TestServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  };
}

const AUTH_HEADER = "Basic dXNlcjp0b2tlbg==";
const CUSTOM_HEADERS = { Cookie: "session=abc", "X-Auth-Token": "secret" };

describe("redirect credential forwarding", () => {
  it("strips auth headers and cookies when following a cross-origin redirect", async () => {
    let targetHeaders: http.IncomingHttpHeaders | undefined;
    const target = await startServer((req, res) => {
      targetHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("target-ok");
    });
    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/landed` });
      res.end();
    });

    try {
      const text = await requestText(`${origin.url}/start`, {
        authHeader: AUTH_HEADER,
        headers: { ...CUSTOM_HEADERS }
      });

      assert.equal(text, "target-ok");
      assert.ok(targetHeaders, "redirect target should have been requested");
      assert.equal(targetHeaders.authorization, undefined);
      assert.equal(targetHeaders.cookie, undefined);
      assert.equal(targetHeaders["x-auth-token"], undefined);
    } finally {
      await origin.close();
      await target.close();
    }
  });

  it("keeps auth headers and cookies when following a same-origin redirect", async () => {
    let finalHeaders: http.IncomingHttpHeaders | undefined;
    const server = await startServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { Location: "/final" });
        res.end();
        return;
      }
      finalHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("same-origin-ok");
    });

    try {
      const text = await requestText(`${server.url}/start`, {
        authHeader: AUTH_HEADER,
        headers: { ...CUSTOM_HEADERS }
      });

      assert.equal(text, "same-origin-ok");
      assert.ok(finalHeaders, "redirect target should have been requested");
      assert.equal(finalHeaders.authorization, AUTH_HEADER);
      assert.equal(finalHeaders.cookie, "session=abc");
      assert.equal(finalHeaders["x-auth-token"], "secret");
    } finally {
      await server.close();
    }
  });

  it("still rejects login redirects so SSO re-auth can react", async () => {
    const server = await startServer((req, res) => {
      if (req.url?.startsWith("/login")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>login</html>");
        return;
      }
      res.writeHead(302, { Location: "/login?from=%2F" });
      res.end();
    });

    try {
      await assert.rejects(
        requestText(`${server.url}/start`, { authHeader: AUTH_HEADER }),
        /redirected to login/i
      );
    } finally {
      await server.close();
    }
  });
});
