import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsCrumbService } from "../src/jenkins/crumbs";
import { JenkinsRequestError } from "../src/jenkins/errors";

const BASE_URL = "https://jenkins.example.com/";

function createCountingCrumbService(
  fetchCrumb: (fetchCount: number) => Promise<unknown> | unknown
): { getFetchCount(): number; service: JenkinsCrumbService } {
  let fetchCount = 0;
  return {
    getFetchCount: () => fetchCount,
    service: new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      return fetchCrumb(fetchCount) as never;
    })
  };
}

async function expectRetryAfterMissingCrumb({
  getFetchCount,
  service
}: {
  getFetchCount(): number;
  service: JenkinsCrumbService;
}): Promise<void> {
  assert.equal(await service.getCrumbHeader(), undefined);
  assert.equal(await service.getCrumbHeader(), undefined);
  assert.equal(getFetchCount(), 2);
}

describe("JenkinsCrumbService crumb fetch caching", () => {
  it("negatively caches a 404 so CSRF-disabled servers are not re-probed", async () => {
    const { getFetchCount, service } = createCountingCrumbService(() => {
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(getFetchCount(), 1);
  });

  it("retries after transient transport errors", async () => {
    const fixture = createCountingCrumbService(() => {
      throw new Error("socket hang up");
    });

    await expectRetryAfterMissingCrumb(fixture);
  });

  it("retries after non-404 request errors", async () => {
    const fixture = createCountingCrumbService(() => {
      throw new JenkinsRequestError("Jenkins API request failed (503 Unavailable)", 503);
    });

    await expectRetryAfterMissingCrumb(fixture);
  });

  it("retries after malformed successful crumb responses", async () => {
    const { getFetchCount, service } = createCountingCrumbService((fetchCount) => {
      if (fetchCount === 1) {
        return { body: {} };
      }
      return { body: { crumbRequestField: "Jenkins-Crumb", crumb: "abc123" } };
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.deepEqual(await service.getCrumbHeader(), {
      field: "Jenkins-Crumb",
      value: "abc123",
      cookie: undefined
    });
    assert.equal(getFetchCount(), 2);
  });

  it("re-probes a negatively cached 404 when forced", async () => {
    const { getFetchCount, service } = createCountingCrumbService((fetchCount) => {
      if (fetchCount === 1) {
        throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
      }
      return { body: { crumbRequestField: "Jenkins-Crumb", crumb: "abc123" } };
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(getFetchCount(), 1);

    const forced = await service.getCrumbHeader(true);
    assert.deepEqual(forced, { field: "Jenkins-Crumb", value: "abc123", cookie: undefined });
    assert.equal(getFetchCount(), 2);
  });

  it("re-probes after invalidate", async () => {
    const { getFetchCount, service } = createCountingCrumbService(() => {
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    service.invalidate();
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(getFetchCount(), 2);
  });

  it("does not cache a crumb fetch that completes after invalidate", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { getFetchCount, service } = createCountingCrumbService(
      () => new Promise((resolve) => pending.push(resolve))
    );

    const staleRequest = service.getCrumbHeader();
    service.invalidate();
    pending[0]?.({ body: { crumbRequestField: "Jenkins-Crumb", crumb: "stale" } });
    await staleRequest;

    const freshRequest = service.getCrumbHeader();
    assert.equal(getFetchCount(), 2);
    pending[1]?.({ body: { crumbRequestField: "Jenkins-Crumb", crumb: "fresh" } });
    assert.equal((await freshRequest)?.value, "fresh");
    assert.equal((await service.getCrumbHeader())?.value, "fresh");
    assert.equal(getFetchCount(), 2);
  });

  it("does not let an older fetch overwrite a newer forced crumb", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { getFetchCount, service } = createCountingCrumbService(
      () => new Promise((resolve) => pending.push(resolve))
    );

    const olderRequest = service.getCrumbHeader();
    const forcedRequest = service.getCrumbHeader(true);
    assert.equal(getFetchCount(), 2);

    pending[1]?.({ body: { crumbRequestField: "Jenkins-Crumb", crumb: "newer" } });
    assert.equal((await forcedRequest)?.value, "newer");
    pending[0]?.({ body: { crumbRequestField: "Jenkins-Crumb", crumb: "older" } });
    await olderRequest;

    assert.equal((await service.getCrumbHeader())?.value, "newer");
    assert.equal(getFetchCount(), 2);
  });

  it("caches a successful crumb fetch", async () => {
    const { getFetchCount, service } = createCountingCrumbService(() => {
      return {
        body: { crumbRequestField: "Jenkins-Crumb", crumb: "abc123" },
        headers: { "set-cookie": ["JSESSIONID=node1; Path=/"] }
      };
    });

    const first = await service.getCrumbHeader();
    const second = await service.getCrumbHeader();
    assert.deepEqual(first, {
      field: "Jenkins-Crumb",
      value: "abc123",
      cookie: "JSESSIONID=node1"
    });
    assert.deepEqual(second, first);
    assert.equal(getFetchCount(), 1);
  });
});
