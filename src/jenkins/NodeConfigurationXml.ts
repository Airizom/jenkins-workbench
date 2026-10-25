import {
  type NodeConfiguration,
  type NodeCreateInput,
  UnsupportedNodeConfigurationError,
  validateNodeName
} from "./NodeManagement";

type ConfigurationField = { text: string; start: number; end: number };
type XmlEvents = {
  error: Error;
  doctype: string;
  opentagstart: unknown;
  opentag: { name: string; attributes: Record<string, string> };
  closetag: unknown;
  text: string;
  cdata: string;
};
interface StrictXmlParser {
  readonly position: number;
  on<K extends keyof XmlEvents>(event: K, listener: (value: XmlEvents[K]) => void): void;
  write(xml: string): StrictXmlParser;
  close(): void;
}

/** Validate the whole document while retaining source spans for lossless edits. */
function parsePermanentConfiguration(xml: string): {
  configuration: NodeConfiguration;
  label?: ConfigurationField;
  insertion: number;
} {
  // Saxes 6's declarations have unconstrained generics rejected by TypeScript 7.
  // Keep its runtime API typed here rather than disabling library checks globally.
  // Loading it only for configuration actions also keeps activation inexpensive.
  const { SaxesParser } = require("saxes") as {
    SaxesParser: new (options: { xmlns: false }) => StrictXmlParser;
  };
  const parser = new SaxesParser({ xmlns: false });
  const fields = new Map<string, ConfigurationField>();
  let depth = 0;
  let tagStart = 0;
  let activeField: ConfigurationField | undefined;
  let insertion = 0;
  parser.on("error", () => {
    throw new Error("Invalid node configuration XML.");
  });
  parser.on("doctype", () => {
    throw new Error("Node configuration contains an unsupported document type.");
  });
  parser.on("opentagstart", () => {
    // Saxes positions are UTF-16 source offsets, including original CRLFs.
    tagStart = xml.lastIndexOf("<", parser.position - 1);
  });
  parser.on("opentag", (tag) => {
    if (
      depth === 0 &&
      (!["slave", "hudson.slaves.DumbSlave"].includes(tag.name) ||
        (tag.attributes.class !== undefined && tag.attributes.class !== "hudson.slaves.DumbSlave"))
    ) {
      throw new UnsupportedNodeConfigurationError();
    }
    depth += 1;
    if (depth === 2 && (tag.name === "name" || tag.name === "label")) {
      if (fields.has(tag.name)) throw new Error("Node configuration contains ambiguous fields.");
      activeField = { text: "", start: tagStart, end: parser.position };
      fields.set(tag.name, activeField);
    } else if (depth > 2 && activeField) {
      throw new Error("Node configuration contains ambiguous fields.");
    }
  });
  const collect = (text: string) => {
    if (activeField) activeField.text += text;
  };
  parser.on("text", collect);
  parser.on("cdata", collect);
  parser.on("closetag", () => {
    if (depth === 2 && activeField) {
      activeField.end = parser.position;
      activeField = undefined;
    }
    if (depth === 1) insertion = xml.lastIndexOf("</", parser.position - 1);
    depth -= 1;
  });
  parser.write(xml).close();
  const name = fields.get("name")?.text ?? "";
  if (!name || validateNodeName(name)) throw new UnsupportedNodeConfigurationError();
  return {
    configuration: { name, labels: (fields.get("label")?.text ?? "").trim() },
    label: fields.get("label"),
    insertion
  };
}

export function readNodeConfiguration(xml: string): NodeConfiguration {
  return parsePermanentConfiguration(xml).configuration;
}

export function updateNodeConfigurationLabels(xml: string, labels: string): string {
  const { label, insertion } = parsePermanentConfiguration(xml);
  const start = label?.start ?? insertion;
  const end = label?.end ?? insertion;
  const updated = `${xml.slice(0, start)}<label>${escapeXml(labels)}</label>${xml.slice(end)}`;
  parsePermanentConfiguration(updated);
  return updated;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildInboundNodeConfiguration(input: NodeCreateInput): string {
  const nameError = validateNodeName(input.name);
  if (nameError) throw new Error(nameError);
  if (!input.remoteFS.trim()) throw new Error("Enter a remote filesystem root.");
  if (!Number.isSafeInteger(input.numExecutors) || input.numExecutors <= 0) {
    throw new Error("Executor count must be a positive integer.");
  }
  if (input.mode !== "NORMAL" && input.mode !== "EXCLUSIVE")
    throw new Error("Invalid node usage mode.");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<slave>\n  <name>${escapeXml(input.name)}</name>\n  <description>${escapeXml(input.description ?? "")}</description>\n  <remoteFS>${escapeXml(input.remoteFS.trim())}</remoteFS>\n  <numExecutors>${input.numExecutors}</numExecutors>\n  <mode>${input.mode}</mode>\n  <retentionStrategy class="hudson.slaves.RetentionStrategy$Always"/>\n  <launcher class="hudson.slaves.JNLPLauncher"/>\n  <label>${escapeXml(input.labels.trim())}</label>\n  <nodeProperties/>\n</slave>`;
}
