/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Snippet fixtures. */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  documentWithCursor,
  enabledConfig,
  jenkinsfileEditorShim,
  matchingScope,
  type TestCompletionList,
  snippetValue
} from "./helpers/jenkinsfileEditorShim";

vi.doMock("vscode", () => jenkinsfileEditorShim);

const { parseSharedLibraryVar, stripHtml } = await import(
  "../src/jenkinsfile/sharedLibraries/JenkinsSharedLibraryVarParser"
);
const { JenkinsfileCompletionProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileCompletionProvider"
);

const URI = "file:///libs/acme/vars/deployApp.groovy";

function parse(text: string, docText?: string) {
  return parseSharedLibraryVar({ name: "deployApp", library: "acme", uri: URI, text, docText });
}

describe("parseSharedLibraryVar", () => {
  it("turns each call overload into a signature", () => {
    const step = parse(
      [
        "def call(String target) {",
        "  echo target",
        "}",
        "",
        "def call(Map config, Closure body) {",
        "  body()",
        "}"
      ].join("\n")
    );

    assert.equal(step.name, "deployApp");
    assert.equal(step.displayName, "deployApp (shared library acme)");
    assert.equal(step.requiresNodeContext, false);
    assert.equal(step.isAdvanced, false);
    assert.deepEqual(step.signatures, [
      {
        label: "deployApp(target: String)",
        parameters: [{ name: "target", type: "String", required: true }],
        usesNamedArgs: false,
        takesClosure: false
      },
      {
        label: "deployApp(config: Map) { ... }",
        parameters: [
          { name: "config", type: "Map", required: true },
          { name: "body", type: "Closure", required: true, isBody: true }
        ],
        usesNamedArgs: false,
        takesClosure: true
      }
    ]);
  });

  it("detects generic Map, qualified Closure, and untyped body parameters", () => {
    const qualified = parse("def call(Map<String, Object> args, groovy.lang.Closure steps) {\n}");
    assert.equal(qualified.signatures[0].usesNamedArgs, false);
    assert.equal(qualified.signatures[0].takesClosure, true);
    assert.equal(qualified.signatures[0].parameters[1].isBody, true);

    const untyped = parse("def call(body) {\n  body()\n}");
    assert.equal(untyped.signatures[0].label, "deployApp() { ... }");
    assert.equal(untyped.signatures[0].takesClosure, true);
    assert.equal(untyped.signatures[0].usesNamedArgs, false);

    const notTrailing = parse("def call(Closure first, String name) {\n}");
    assert.equal(notTrailing.signatures[0].takesClosure, false);
    assert.equal(notTrailing.signatures[0].parameters[0].isBody, undefined);
  });

  it("keeps a leading Map parameter positional in the label and completion snippet", async () => {
    const step = parse("def call(Map c = [:], Closure body) {\n  body()\n}");
    assert.deepEqual(step.signatures[0], {
      label: "deployApp(c: Map = …) { ... }",
      parameters: [
        { name: "c", type: "Map", required: false },
        { name: "body", type: "Closure", required: true, isBody: true }
      ],
      usesNamedArgs: false,
      takesClosure: true
    });

    const provider = new JenkinsfileCompletionProvider(
      enabledConfig as never,
      matchingScope as never,
      {
        getCatalogForDocument: async () => ({
          kind: "fallback-no-environment",
          catalog: { steps: new Map([[step.name, step]]), directives: new Map() }
        })
      } as never
    );
    const { document, position } = documentWithCursor("node {\n  deploy/*cursor*/\n}");
    const result = (await provider.provideCompletionItems(document as never, position as never)) as
      | TestCompletionList
      | undefined;
    const item = result?.items.find((entry) => entry.label === "deployApp");
    assert.equal(snippetValue(item), "deployApp(${value}) {\n\t$0\n}");
  });

  it("marks parameters with defaults as optional", () => {
    const step = parse("def call(String name, int retries = 3, flag = false) {\n}");
    assert.deepEqual(
      step.signatures[0].parameters.map((parameter) => [parameter.name, parameter.required]),
      [
        ["name", true],
        ["retries", false],
        ["flag", false]
      ]
    );
    assert.equal(step.signatures[0].label, "deployApp(name: String, retries: int = …, flag = …)");
  });

  it("records other top-level methods as members with 0-based locations", () => {
    const step = parse(
      [
        "import groovy.transform.Field",
        "",
        "def call() {",
        "  helper()",
        "}",
        "",
        "@NonCPS",
        "String helper(String value, Map options = [:]) {",
        "  return value",
        "}",
        "",
        "  void cleanup() {",
        "  }"
      ].join("\n")
    );

    assert.equal(step.source?.kind, "sharedLibrary");
    assert.equal(step.source?.library, "acme");
    assert.equal(step.source?.uri, URI);
    assert.equal(step.source?.line, 2);
    assert.equal(step.source?.character, 4);
    assert.deepEqual(step.source?.members, [
      {
        name: "helper",
        signatureLabel: "helper(value: String, options: Map = …)",
        uri: URI,
        line: 7,
        character: 7
      },
      { name: "cleanup", signatureLabel: "cleanup()", uri: URI, line: 11, character: 7 }
    ]);
  });

  it("ignores methods nested in closures or classes", () => {
    const step = parse(
      [
        "def call() {",
        "  def inner() {",
        "  }",
        "}",
        "class Helper {",
        "  def nested() {}",
        "}"
      ].join("\n")
    );
    assert.equal(step.signatures.length, 1);
    assert.deepEqual(step.source?.members, []);
  });

  it("keeps a var without call as a definition with no signatures", () => {
    const step = parse("def version() {\n  '1.0'\n}\n");
    assert.deepEqual(step.signatures, []);
    assert.equal(step.source?.line, 0);
    assert.equal(step.source?.character, 0);
    assert.deepEqual(
      step.source?.members.map((member) => member.name),
      ["version"]
    );
  });

  it("uses the stripped .txt help as documentation", () => {
    const step = parse(
      "def call() {}",
      "<p>Deploys the <b>app</b> &amp; waits.</p>\n<ul><li>Uses &lt;target&gt;</li><li>Retries&nbsp;twice</li></ul>"
    );
    assert.equal(
      step.documentation,
      "Deploys the app & waits.\n\n- Uses <target>\n- Retries twice"
    );
  });

  it("leaves documentation undefined when help is missing or empty", () => {
    assert.equal(parse("def call() {}").documentation, undefined);
    assert.equal(parse("def call() {}", "  <p> </p>  ").documentation, undefined);
  });
});

describe("stripHtml", () => {
  it("removes tags and comments and decodes numeric entities", () => {
    assert.equal(
      stripHtml("a<!-- hidden --><br/>b&#65;&#x42;&quot;&#39;&unknown;"),
      "a\nbAB\"'&unknown;"
    );
  });

  it("drops script and style content", () => {
    assert.equal(stripHtml("<style>p{}</style>Text<script>alert(1)</script>"), "Text");
  });
});
