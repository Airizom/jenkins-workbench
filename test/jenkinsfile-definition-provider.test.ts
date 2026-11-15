import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

class TestPosition {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

class TestRange {
  constructor(
    readonly start: TestPosition,
    readonly end: TestPosition
  ) {}
}

class TestUri {
  constructor(readonly value: string) {}

  static parse(value: string): TestUri {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      throw new Error(`invalid uri: ${value}`);
    }
    return new TestUri(value);
  }

  toString(): string {
    return this.value;
  }
}

class TestLocation {
  constructor(
    readonly uri: TestUri,
    readonly range: TestPosition | TestRange
  ) {}
}

vi.doMock("vscode", () => ({
  Location: TestLocation,
  Position: TestPosition,
  Range: TestRange,
  Uri: TestUri
}));

const { JenkinsfileDefinitionProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileDefinitionProvider"
);

const DOCUMENT_URI = new TestUri("file:///workspace/Jenkinsfile");
const VAR_URI = "file:///workspace/lib/vars/deployApp.groovy";
let nextVersion = 1;

function createDocument(text: string) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return {
    uri: DOCUMENT_URI,
    version: nextVersion++,
    getText: () => text,
    positionAt(offset: number): TestPosition {
      const clamped = Math.min(Math.max(offset, 0), text.length);
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= clamped) {
        line += 1;
      }
      return new TestPosition(line, clamped - lineStarts[line]);
    },
    offsetAt(position: TestPosition): number {
      return Math.min(lineStarts[position.line] + position.character, text.length);
    }
  };
}

function createCatalogSource() {
  const steps = new Map([
    [
      "deployApp",
      {
        name: "deployApp",
        displayName: "deployApp",
        requiresNodeContext: false,
        isAdvanced: false,
        signatures: [],
        source: {
          kind: "sharedLibrary" as const,
          library: "shared",
          uri: VAR_URI,
          line: 3,
          character: 4,
          members: [
            {
              name: "rollback",
              signatureLabel: "rollback(String env)",
              uri: VAR_URI,
              line: 12,
              character: 4
            }
          ]
        }
      }
    ],
    [
      "sh",
      {
        name: "sh",
        displayName: "Shell Script",
        requiresNodeContext: true,
        isAdvanced: false,
        signatures: []
      }
    ]
  ]);
  return {
    calls: 0,
    async getCatalogForDocument() {
      this.calls += 1;
      return {
        kind: "fallback-no-environment" as const,
        catalog: { steps, directives: new Map() }
      };
    }
  };
}

function createProvider(enabled = true, matches = true) {
  const catalogSource = createCatalogSource();
  const provider = new JenkinsfileDefinitionProvider(
    { isEnabled: () => enabled } as never,
    { matches: () => matches },
    catalogSource as never
  );
  return { provider, catalogSource };
}

/** Resolves the definition at the `|` marker, which is removed from the text. */
async function definitionAt(markedText: string, enabled = true, matches = true) {
  const offset = markedText.indexOf("|");
  assert.ok(offset >= 0, "fixture needs a | marker");
  const document = createDocument(markedText.slice(0, offset) + markedText.slice(offset + 1));
  const { provider, catalogSource } = createProvider(enabled, matches);
  const location = (await provider.provideDefinition(
    document as never,
    document.positionAt(offset) as never
  )) as TestLocation | undefined;
  return { location, document, catalogSource };
}

describe("JenkinsfileDefinitionProvider", () => {
  it("resolves a shared-library global to its var file", async () => {
    const { location } = await definitionAt("node {\n  deplo|yApp env: 'prod'\n}\n");
    assert.ok(location);
    assert.equal(location.uri.toString(), VAR_URI);
    assert.deepEqual(location.range, new TestPosition(3, 4));
  });

  it("resolves the receiver of a member call to the var file", async () => {
    const { location } = await definitionAt("deployApp|.rollback('prod')\n");
    assert.equal(location?.uri.toString(), VAR_URI);
    assert.deepEqual(location?.range, new TestPosition(3, 4));
  });

  it("resolves a shared-library member to its declaration", async () => {
    const { location } = await definitionAt("deployApp.roll|back('prod')\n");
    assert.ok(location);
    assert.equal(location.uri.toString(), VAR_URI);
    assert.deepEqual(location.range, new TestPosition(12, 4));
  });

  it("resolves safe-navigation member access", async () => {
    const { location } = await definitionAt("deployApp?.|rollback('prod')\n");
    assert.deepEqual(location?.range, new TestPosition(12, 4));
  });

  it("ignores unknown members and members of nested receivers", async () => {
    assert.equal((await definitionAt("deployApp.unkn|own()\n")).location, undefined);
    assert.equal((await definitionAt("config.deployApp.roll|back()\n")).location, undefined);
    assert.equal((await definitionAt("config.deploy|App()\n")).location, undefined);
  });

  it("rejects spread, range, and whitespace around the member dot", async () => {
    for (const text of [
      "deployApp*.roll|back()\n",
      "0..deploy|App\n",
      "deployApp .roll|back()\n",
      "deployApp. roll|back()\n",
      "x. deployApp.roll|back()\n"
    ]) {
      const { location, catalogSource } = await definitionAt(text);
      assert.equal(location, undefined, text);
      assert.equal(catalogSource.calls, 0, text);
    }
  });

  it("resolves a call to a top-level method in the same document", async () => {
    const text =
      "def notifySlack(String channel) {\n  echo channel\n}\n\nnode {\n  notify|Slack('#ci')\n}\n";
    const { location, document } = await definitionAt(text);
    assert.ok(location);
    assert.equal(location.uri, DOCUMENT_URI);
    const range = location.range as TestRange;
    assert.deepEqual(range.start, document.positionAt(4));
    assert.deepEqual(range.end, document.positionAt(4 + "notifySlack".length));
  });

  it("prefers a local method over a library global with the same name", async () => {
    const { location } = await definitionAt("def deployApp() {}\ndeploy|App()\n");
    assert.equal(location?.uri, DOCUMENT_URI);
  });

  it("returns nothing inside strings or comments", async () => {
    const results = await Promise.all([
      definitionAt("echo 'deploy|App'\n"),
      definitionAt('echo "run deploy|App now"\n'),
      definitionAt("// deploy|App\n"),
      definitionAt("/* deployApp.roll|back */\n")
    ]);
    for (const { location, catalogSource } of results) {
      assert.equal(location, undefined);
      assert.equal(catalogSource.calls, 0);
    }
  });

  it("returns nothing for steps without a source, keys, and assignments", async () => {
    assert.equal((await definitionAt("s|h 'make'\n")).location, undefined);
    assert.equal((await definitionAt("build(deploy|App: true)\n")).location, undefined);
    assert.equal((await definitionAt("deploy|App = 1\n")).location, undefined);
    assert.equal((await definitionAt("node { | }\n")).location, undefined);
  });

  it("resolves references before the : of a ternary or case label", async () => {
    for (const text of [
      "def x = cond ? deploy|App : null\n",
      "def x = cond ? !deploy|App : null\n",
      "switch (x) {\n  case deploy|App:\n    break\n}\n"
    ]) {
      assert.equal((await definitionAt(text)).location?.uri.toString(), VAR_URI, text);
    }
    // Keys keep resolving to nothing.
    for (const text of [
      "build([deploy|App: true])\n",
      "build(a: 1, deploy|App: true)\n",
      "build(\n  deploy|App: true\n)\n",
      "git deploy|App: 'x'\n"
    ]) {
      assert.equal((await definitionAt(text)).location, undefined, text);
    }
  });

  it("returns nothing when gated off", async () => {
    const disabled = await definitionAt("deploy|App()\n", false, true);
    const outOfScope = await definitionAt("deploy|App()\n", true, false);
    assert.equal(disabled.location, undefined);
    assert.equal(outOfScope.location, undefined);
    assert.equal(disabled.catalogSource.calls + outOfScope.catalogSource.calls, 0);
  });

  it("returns nothing when the source URI cannot be parsed", async () => {
    const catalogSource = {
      async getCatalogForDocument() {
        return {
          kind: "fallback-no-environment" as const,
          catalog: {
            steps: new Map([
              [
                "broken",
                {
                  name: "broken",
                  displayName: "broken",
                  requiresNodeContext: false,
                  isAdvanced: false,
                  signatures: [],
                  source: {
                    kind: "sharedLibrary" as const,
                    library: "shared",
                    uri: "not a uri",
                    line: 0,
                    character: 0,
                    members: []
                  }
                }
              ]
            ]),
            directives: new Map()
          }
        };
      }
    };
    const provider = new JenkinsfileDefinitionProvider(
      { isEnabled: () => true } as never,
      { matches: () => true },
      catalogSource as never
    );
    const document = createDocument("broken()\n");
    const location = await provider.provideDefinition(
      document as never,
      document.positionAt(2) as never
    );
    assert.equal(location, undefined);
  });
});
