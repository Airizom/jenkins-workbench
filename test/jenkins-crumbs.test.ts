import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JenkinsCrumbService } from "../src/jenkins/crumbs";
import { JenkinsRequestError } from "../src/jenkins/errors";

const BASE_URL = "https://jenkins.example.com/";

describe("JenkinsCrumbService crumb fetch caching", () => {
  it("negatively caches a 404 so CSRF-disabled servers are not re-probed", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(fetchCount, 1);
  });

  it("retries after transient transport errors", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      throw new Error("socket hang up");
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(fetchCount, 2);
  });

  it("retries after non-404 request errors", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      throw new JenkinsRequestError("Jenkins API request failed (503 Unavailable)", 503);
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(fetchCount, 2);
  });

  it("re-probes a negatively cached 404 when forced", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
      }
      return { body: { crumbRequestField: "Jenkins-Crumb", crumb: "abc123" } };
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(fetchCount, 1);

    const forced = await service.getCrumbHeader(true);
    assert.deepEqual(forced, { field: "Jenkins-Crumb", value: "abc123", cookie: undefined });
    assert.equal(fetchCount, 2);
  });

  it("re-probes after invalidate", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
      throw new JenkinsRequestError("Jenkins API request failed (404 Not Found)", 404);
    });

    assert.equal(await service.getCrumbHeader(), undefined);
    service.invalidate();
    assert.equal(await service.getCrumbHeader(), undefined);
    assert.equal(fetchCount, 2);
  });

  it("caches a successful crumb fetch", async () => {
    let fetchCount = 0;
    const service = new JenkinsCrumbService(BASE_URL, async () => {
      fetchCount += 1;
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
    assert.equal(fetchCount, 1);
  });
});
