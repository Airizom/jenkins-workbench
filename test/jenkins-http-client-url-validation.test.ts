import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const BASE_URL = "https://jenkins.example.com/jenkins/";
const CROSS_ORIGIN_URL = "https://attacker.example.com/collect";

const requestMock = {
  requestBufferWithHeaders: vi.fn(),
  requestHeaders: vi.fn(),
  requestJson: vi.fn(),
  requestStream: vi.fn(),
  requestText: vi.fn(),
  requestTextWithHeaders: vi.fn(),
  requestVoidWithLocation: vi.fn()
};

vi.doMock("../src/jenkins/request", () => requestMock);
const { JenkinsHttpClient } = await import("../src/jenkins/client/JenkinsHttpClient");

type Client = InstanceType<typeof JenkinsHttpClient>;
type RequestVariant = (client: Client, url: string) => Promise<unknown>;

const REQUEST_VARIANTS: Array<[string, RequestVariant]> = [
  ["requestJson", (client, url) => client.requestJson(url)],
  ["requestHeaders", (client, url) => client.requestHeaders(url)],
  ["requestText", (client, url) => client.requestText(url)],
  ["requestTextWithHeaders", (client, url) => client.requestTextWithHeaders(url)],
  ["requestBufferWithHeaders", (client, url) => client.requestBufferWithHeaders(url)],
  ["requestStream", (client, url) => client.requestStream(url)],
  ["requestVoidWithCrumb", (client, url) => client.requestVoidWithCrumb(url)],
  ["requestPostWithCrumb", (client, url) => client.requestPostWithCrumb(url)],
  ["requestPostWithCrumbRaw", (client, url) => client.requestPostWithCrumbRaw(url, "body")],
  ["requestPostTextWithCrumbRaw", (client, url) => client.requestPostTextWithCrumbRaw(url, "body")]
];

const AUTHENTICATED_CLIENTS: Array<[string, () => Client]> = [
  [
    "basic auth",
    () => new JenkinsHttpClient({ baseUrl: BASE_URL, username: "user", token: "token" })
  ],
  [
    "SSO auth",
    () =>
      new JenkinsHttpClient({
        baseUrl: BASE_URL,
        authConfig: {
          type: "sso",
          loginUrl: `${BASE_URL}__sso/login`,
          headers: { Cookie: "session=secret" }
        }
      })
  ]
];

describe("JenkinsHttpClient destination validation", () => {
  beforeEach(() => {
    for (const request of Object.values(requestMock)) {
      request.mockReset();
    }
  });

  for (const [authName, createClient] of AUTHENTICATED_CLIENTS) {
    describe(authName, () => {
      for (const [requestName, request] of REQUEST_VARIANTS) {
        it(`rejects cross-origin ${requestName} before invoking the transport`, async () => {
          await assert.rejects(request(createClient(), CROSS_ORIGIN_URL), /untrusted origin/i);
          assertNoTransportRequests();
        });
      }
    });
  }

  it("rejects non-HTTP URLs and URLs containing embedded credentials", async () => {
    const client = new JenkinsHttpClient({
      baseUrl: BASE_URL,
      username: "user",
      token: "token"
    });

    await assert.rejects(client.requestText("file:///tmp/secret"), /protocol/i);
    await assert.rejects(
      client.requestText("https://embedded:secret@jenkins.example.com/jenkins/api/json"),
      /embedded credentials/i
    );
    assertNoTransportRequests();
  });
});

function assertNoTransportRequests(): void {
  for (const request of Object.values(requestMock)) {
    assert.equal(request.mock.calls.length, 0);
  }
}
