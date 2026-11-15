import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { JenkinsfileSharedLibrarySummary } from "../src/jenkinsfile/JenkinsfileIntelligenceTypes";
import * as vscodeStub from "./helpers/vscodeStub";

class TestHover {
  constructor(
    readonly contents: vscodeStub.MarkdownString,
    readonly range: vscodeStub.Range
  ) {}
}

vi.doMock("vscode", () => ({ ...vscodeStub, Hover: TestHover }));

const { JenkinsfileLibraryHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileLibraryHoverProvider"
);
const { JenkinsfileIntelligenceConfigState } = await import(
  "../src/jenkinsfile/JenkinsfileIntelligenceConfigState"
);

function createDocument(text: string): vscode.TextDocument {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return {
    uri: vscodeStub.Uri.file("/ws/app/Jenkinsfile"),
    version: 1,
    getText: () => text,
    offsetAt: (position: vscode.Position) => lineStarts[position.line] + position.character,
    positionAt: (offset: number) => {
      let line = 0;
      while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) {
        line += 1;
      }
      return new vscodeStub.Position(line, offset - lineStarts[line]);
    }
  } as unknown as vscode.TextDocument;
}

function createLibrary(
  overrides: Partial<JenkinsfileSharedLibrarySummary> = {}
): JenkinsfileSharedLibrarySummary {
  return {
    name: "acme",
    rootUri: vscodeStub.Uri.file("/libs/acme").toString(),
    implicit: false,
    configured: true,
    varNames: ["deploy", "notify"],
    ...overrides
  };
}

function createProvider(
  libraries: JenkinsfileSharedLibrarySummary[],
  options: { enabled?: boolean; matches?: boolean } = {}
) {
  const requested: string[] = [];
  const provider = new JenkinsfileLibraryHoverProvider(
    new JenkinsfileIntelligenceConfigState({ enabled: options.enabled ?? true }),
    { matches: () => options.matches ?? true },
    {
      getLibrary: async (name: string) => {
        requested.push(name);
        return libraries.find((library) => library.name === name);
      }
    }
  );
  return { provider, requested };
}

const TEXT = "@Library('acme@v2') _\nlibrary 'other'\npipeline {}\n";

async function hoverAt(
  provider: InstanceType<typeof JenkinsfileLibraryHoverProvider>,
  line: number,
  character: number
) {
  const hover = (await provider.provideHover(
    createDocument(TEXT),
    new vscodeStub.Position(line, character) as unknown as vscode.Position
  )) as unknown as TestHover | undefined;
  return hover;
}

describe("JenkinsfileLibraryHoverProvider", () => {
  it("describes a mapped library", async () => {
    const { provider, requested } = createProvider([createLibrary()]);
    const hover = await hoverAt(provider, 0, 11);

    assert.ok(hover);
    assert.deepEqual(requested, ["acme"]);
    assert.equal(
      hover.contents.value,
      "**Shared library** acme\n\nLocal path: /libs/acme\n\nGlobal variables: 2 vars\n\n" +
        "Mapping: configured\n\nRequested version v2 is not checked; the local folder is used as-is."
    );
    assert.deepEqual(hover.range.start, new vscodeStub.Position(0, 10));
    assert.deepEqual(hover.range.end, new vscodeStub.Position(0, 14));
  });

  it("reports implicit and discovered mappings", async () => {
    const implicit = await hoverAt(
      createProvider([createLibrary({ implicit: true })]).provider,
      0,
      12
    );
    assert.match(implicit?.contents.value ?? "", /Mapping: implicit/);

    const discovered = await hoverAt(
      createProvider([createLibrary({ configured: false, varNames: ["one"] })]).provider,
      0,
      12
    );
    assert.match(
      discovered?.contents.value ?? "",
      /Global variables: 1 var\n\nMapping: discovered/
    );
  });

  it("explains how to map an unknown library", async () => {
    const { provider } = createProvider([createLibrary()]);
    const hover = await hoverAt(provider, 1, 10);

    assert.equal(
      hover?.contents.value,
      "No local checkout for library 'other' — map it in `jenkinsWorkbench.jenkinsfile.sharedLibraries`"
    );
    assert.deepEqual(hover?.range.start, new vscodeStub.Position(1, 9));
    assert.deepEqual(hover?.range.end, new vscodeStub.Position(1, 14));
  });

  it("returns nothing outside library ids or when intelligence does not apply", async () => {
    const { provider, requested } = createProvider([createLibrary()]);
    assert.equal(await hoverAt(provider, 2, 3), undefined);
    assert.deepEqual(requested, []);

    assert.equal(
      await hoverAt(createProvider([createLibrary()], { enabled: false }).provider, 0, 11),
      undefined
    );
    assert.equal(
      await hoverAt(createProvider([createLibrary()], { matches: false }).provider, 0, 11),
      undefined
    );
  });
});
