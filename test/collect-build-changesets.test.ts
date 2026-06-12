import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectBuildChangesets } from "../src/jenkins/changesets/collectBuildChangesets";
import type { JenkinsChangeSetItem } from "../src/jenkins/types";

function changesetItem(
  commitId: string | undefined,
  msg: string,
  fullName: string
): JenkinsChangeSetItem {
  return {
    commitId,
    msg,
    author: { fullName }
  };
}

describe("collectBuildChangesets", () => {
  it("dedupes exact duplicate items in a single change set", () => {
    const item = changesetItem("abc123", "Update pipeline", "Ada Lovelace");

    const result = collectBuildChangesets({
      changeSet: {
        items: [item, item]
      }
    });

    assert.deepEqual(result, [
      {
        message: "Update pipeline",
        author: "Ada Lovelace",
        commitId: "abc123"
      }
    ]);
  });

  it("keeps distinct items from different change sets when commit ids collide", () => {
    const result = collectBuildChangesets({
      changeSets: [
        {
          items: [changesetItem("123", "Update app", "Ada Lovelace")]
        },
        {
          items: [changesetItem("123", "Update infra", "Grace Hopper")]
        }
      ]
    });

    assert.deepEqual(result, [
      {
        message: "Update app",
        author: "Ada Lovelace",
        commitId: "123"
      },
      {
        message: "Update infra",
        author: "Grace Hopper",
        commitId: "123"
      }
    ]);
  });
});
