import assert from "node:assert/strict";
import { describe, it } from "vitest";
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
  it("decodes decimal and hexadecimal apostrophe entities", () => {
    const definition = parseReplayDefinitionPage(replayPage("echo &#39;&#x27;"));

    assert.equal(definition.mainScript, "echo ''");
  });

  it("preserves out-of-range numeric entities instead of throwing", () => {
    const definition = parseReplayDefinitionPage(replayPage("echo '&#9999999999;'"));

    assert.equal(definition.mainScript, "echo '&#9999999999;'");
  });

  it("preserves surrogate numeric entities", () => {
    const definition = parseReplayDefinitionPage(replayPage("echo &#55296;&#xDFFF;"));

    assert.equal(definition.mainScript, "echo &#55296;&#xDFFF;");
  });
});
