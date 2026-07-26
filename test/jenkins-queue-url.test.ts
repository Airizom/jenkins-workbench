import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseQueueItemId } from "../src/jenkins/urls";

describe("parseQueueItemId", () => {
  it.each([
    ["https://jenkins.example/queue/item/42/", 42],
    ["http://jenkins.example/queue/item/7", 7],
    ["/queue/item/12/", 12],
    ["queue/item/19", 19],
    ["/jenkins/queue/item/23/", 23],
    ["jenkins/team/queue/item/31?from=task#status", 31],
    ["//jenkins.example/context/queue/item/37/", 37],
    ["/queue/item/0041/", 41],
    [`/queue/item/${Number.MAX_SAFE_INTEGER}/`, Number.MAX_SAFE_INTEGER]
  ])("parses %s", (queueLocation, expected) => {
    assert.equal(parseQueueItemId(queueLocation), expected);
  });

  it.each([
    undefined,
    "",
    " ",
    "https://jenkins.example/job/project/42/",
    "/queue/items/42/",
    "/queue/item/",
    "/queue/item/0/",
    "/queue/item/-1/",
    "/queue/item/1.5/",
    "/queue/item/42x/",
    "/queue/item/%34%32/",
    "/queue/item/42/api/json",
    `/queue/item/${Number.MAX_SAFE_INTEGER + 1}/`,
    "mailto:queue/item/42",
    " /queue/item/42/",
    "/queue/item/42/ "
  ])("rejects malformed or unsafe location %j", (queueLocation) => {
    assert.equal(parseQueueItemId(queueLocation), undefined);
  });
});
