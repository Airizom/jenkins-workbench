import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsReplayClient } from "../src/jenkins/client/JenkinsReplayClient";
import { parseReplayDefinitionPage } from "../src/jenkins/client/ReplayPageParser";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

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

  it("preserves a leading newline encoded as an HTML entity", () => {
    const definition = parseReplayDefinitionPage(replayPage("&#10;  pipeline { }"));

    assert.equal(definition.mainScript, "\n  pipeline { }");
  });

  it("preserves script whitespace when parsing and submitting replay", async () => {
    const html = `
      <form action="run">
        <div class="jenkins-form-item">
          <div class="jenkins-form-label">Pipeline Script</div>
          <textarea name="_.mainScript">pipeline { }\n</textarea>
        </div>
        <div class="jenkins-form-item">
          <div class="jenkins-form-label">Loaded Script</div>
          <textarea name="_.loadedScript">\n\t  println 'hi'\n  </textarea>
        </div>
      </form>
    `;
    let submittedBody: string | undefined;
    const client = new JenkinsReplayClient(
      createJenkinsClientContext({
        requestText: async () => html,
        requestPostWithCrumb: async (_url, body) => {
          if (typeof body !== "string") {
            throw new Error("Expected a form-encoded replay body.");
          }
          submittedBody = body;
          return {};
        }
      })
    );

    const definition = await client.getReplayDefinition("https://jenkins.example.com/job/demo/5/");
    assert.equal(definition.mainScript, "pipeline { }\n");
    assert.equal(definition.loadedScripts[0].script, "\t  println 'hi'\n  ");

    await client.runReplay("https://jenkins.example.com/job/demo/5/", definition);
    const submitted = new URLSearchParams(submittedBody);
    assert.equal(submitted.get("mainScript"), definition.mainScript);
    assert.equal(submitted.get("loadedScript"), definition.loadedScripts[0].script);
  });
});
