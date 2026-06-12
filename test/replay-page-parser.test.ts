import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReplayDefinitionPage } from "../src/jenkins/client/ReplayPageParser";

function replayPage(script: string): string {
  return `
    <form action="run">
      <div class="jenkins-form-item">
        <div class="jenkins-form-label">Pipeline Script</div>
        <textarea name="_.mainScript">${script}</textarea>
      </div>
    </form>
  `;
}

describe("parseReplayDefinitionPage", () => {
  it("preserves out-of-range numeric entities instead of throwing", () => {
    const definition = parseReplayDefinitionPage(replayPage("echo '&#9999999999;'"));

    assert.equal(definition.mainScript, "echo '&#9999999999;'");
  });
});
