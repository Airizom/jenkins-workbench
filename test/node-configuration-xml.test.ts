import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildInboundNodeConfiguration,
  readNodeConfiguration,
  updateNodeConfigurationLabels
} from "../src/jenkins/NodeConfigurationXml";
import { UnsupportedNodeConfigurationError, validateNodeName } from "../src/jenkins/NodeManagement";

const config = `<slave plugin="test"><name>agent</name><label>Linux &quot;two words&quot;</label><launcher class="ssh"><credentialsId>secret-id</credentialsId><label>nested</label></launcher><nodeProperties><unknown value="x">keep &amp; keep</unknown></nodeProperties></slave>`;

describe("node configuration XML", () => {
  it("reads only configured labels and changes only the direct label element", () => {
    assert.deepEqual(readNodeConfiguration(config), { name: "agent", labels: 'Linux "two words"' });
    const updated = updateNodeConfigurationLabels(config, 'windows "other words" & gpu');
    assert.equal(readNodeConfiguration(updated).labels, 'windows "other words" & gpu');
    assert.match(updated, /<credentialsId>secret-id<\/credentialsId>/);
    assert.match(updated, /<label>nested<\/label>/);
    assert.match(updated, /<unknown value="x">keep &amp; keep<\/unknown>/);
    assert.match(updated, /plugin="test"/);
  });

  it("clears labels and supports a missing direct label", () => {
    assert.equal(readNodeConfiguration(updateNodeConfigurationLabels(config, "")).labels, "");
    const source =
      "<hudson.slaves.DumbSlave><name>agent</name><launcher/></hudson.slaves.DumbSlave>";
    assert.equal(readNodeConfiguration(source).labels, "");
    assert.equal(
      readNodeConfiguration(updateNodeConfigurationLabels(source, "linux")).labels,
      "linux"
    );
  });

  it("preserves all non-label source text including CR references, CDATA and non-BMP text", () => {
    const source =
      '<?xml version="1.0"?>\r\n<!--😀--><slave><name>agent</name><launcher command="a&#13;&#10;b"><script>a&#13;\nb</script><![CDATA[<label>not the field</label>]]></launcher><label>old</label></slave>';
    assert.equal(
      updateNodeConfigurationLabels(source, "new"),
      source.replace("<label>old</label>", "<label>new</label>")
    );
    const labelCdata = "<slave><name>agent</name><label><![CDATA[</label>]]></label></slave>";
    assert.equal(readNodeConfiguration(labelCdata).labels, "</label>");
    assert.equal(
      updateNodeConfigurationLabels(labelCdata, ""),
      "<slave><name>agent</name><label></label></slave>"
    );
  });

  it.each([
    "<jenkins><label>built-in</label></jenkins>",
    "<cloud.slave><name>cloud</name><label>linux</label></cloud.slave>",
    '<slave class="cloud.Agent"><name>cloud</name></slave>',
    "<slave><name></name></slave>"
  ])("rejects unsupported nodes: %s", (xml) => {
    assert.throws(() => readNodeConfiguration(xml), UnsupportedNodeConfigurationError);
  });

  it.each([
    "<slave><name>agent</name><label>a</label><label>b</label></slave>",
    "<slave><name>agent</name><label><bad/></label></slave>",
    "<slave><name>agent</name></bad>",
    "junk<slave><name>agent</name></slave>",
    "<slave><name>agent</name></slave>junk",
    "<slave><name>agent</name></slave><slave><name>other</name></slave>",
    "<!--invalid--comment--><slave><name>agent</name></slave>",
    "<slave><name>agent</name><label>bad\u0000value</label></slave>",
    '<!DOCTYPE slave [<!ENTITY secret SYSTEM "file:///etc/passwd">]><slave><name>agent</name></slave>',
    "<slave><name>agent</name><label>&unknown;</label></slave>"
  ])("rejects malformed or ambiguous configuration: %s", (xml) => {
    assert.throws(() => readNodeConfiguration(xml));
  });

  it("creates escaped inbound agents with standard retention and requested fields", () => {
    const xml = buildInboundNodeConfiguration({
      name: "agent-é",
      remoteFS: "/opt/a&b",
      numExecutors: 2,
      labels: 'Linux "two words"',
      mode: "EXCLUSIVE",
      description: "<note>"
    });
    assert.deepEqual(readNodeConfiguration(xml), { name: "agent-é", labels: 'Linux "two words"' });
    assert.match(xml, /<remoteFS>\/opt\/a&amp;b<\/remoteFS>/);
    assert.match(xml, /<numExecutors>2<\/numExecutors>/);
    assert.match(xml, /<description>&lt;note&gt;<\/description>/);
    assert.match(xml, /hudson.slaves.JNLPLauncher/);
    assert.match(xml, /hudson.slaves.RetentionStrategy\$Always/);
  });

  it.each([
    "",
    " ",
    ".",
    "..",
    "a/b",
    "a\\b",
    "a?b",
    " leading",
    "trailing ",
    "a\u0000b",
    "a[b",
    "a]b"
  ])("rejects invalid node name %j", (name) => {
    assert.equal(typeof validateNodeName(name), "string");
  });

  it("validates inbound configuration", () => {
    const input = {
      name: "agent",
      remoteFS: "/tmp/a",
      numExecutors: 1,
      labels: "",
      mode: "NORMAL" as const
    };
    for (const numExecutors of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => buildInboundNodeConfiguration({ ...input, numExecutors }));
    }
    assert.throws(() => buildInboundNodeConfiguration({ ...input, remoteFS: " " }));
  });
});
