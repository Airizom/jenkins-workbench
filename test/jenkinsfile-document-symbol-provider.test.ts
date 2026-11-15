/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Groovy GString fixtures. */
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

class TestDocumentSymbol {
  children: TestDocumentSymbol[] = [];

  constructor(
    readonly name: string,
    readonly detail: string,
    readonly kind: number,
    readonly range: TestRange,
    readonly selectionRange: TestRange
  ) {
    if (!name) {
      throw new Error("name must not be falsy");
    }
  }
}

const SymbolKind = { Module: 1, Namespace: 2, Package: 3, Method: 5 };

vi.doMock("vscode", () => ({
  DocumentSymbol: TestDocumentSymbol,
  Position: TestPosition,
  Range: TestRange,
  SymbolKind
}));

const { JenkinsfileDocumentSymbolProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileDocumentSymbolProvider"
);

let nextVersion = 1;

function createDocument(text: string) {
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return {
    uri: { toString: () => "file:///Jenkinsfile" },
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

function createProvider(enabled = true, matches = true) {
  return new JenkinsfileDocumentSymbolProvider({ isEnabled: () => enabled } as never, {
    matches: () => matches
  });
}

function provide(text: string, enabled = true, matches = true) {
  const document = createDocument(text);
  const symbols = createProvider(enabled, matches).provideDocumentSymbols(
    document as never
  ) as unknown as TestDocumentSymbol[];
  return { document, symbols };
}

interface SymbolSummary {
  name: string;
  kind: number;
  detail?: string;
  children?: SymbolSummary[];
}

function summarize(symbols: TestDocumentSymbol[]): SymbolSummary[] {
  return symbols.map((symbol) => {
    const summary: SymbolSummary = { name: symbol.name, kind: symbol.kind };
    if (symbol.detail) {
      summary.detail = symbol.detail;
    }
    if (symbol.children.length > 0) {
      summary.children = summarize(symbol.children);
    }
    return summary;
  });
}

function compare(left: TestPosition, right: TestPosition): number {
  return left.line - right.line || left.character - right.character;
}

function assertWellFormed(symbols: TestDocumentSymbol[]): void {
  for (const symbol of symbols) {
    assert.ok(symbol.name.trim(), "symbol name must not be empty");
    assert.ok(compare(symbol.range.start, symbol.range.end) <= 0);
    assert.ok(compare(symbol.range.start, symbol.selectionRange.start) <= 0);
    assert.ok(compare(symbol.selectionRange.start, symbol.selectionRange.end) <= 0);
    assert.ok(compare(symbol.selectionRange.end, symbol.range.end) <= 0);
    for (const child of symbol.children) {
      assert.ok(compare(symbol.range.start, child.range.start) <= 0);
      assert.ok(compare(child.range.end, symbol.range.end) <= 0);
    }
    assertWellFormed(symbol.children);
  }
}

function textAt(document: ReturnType<typeof createDocument>, range: TestRange): string {
  return document.getText().slice(document.offsetAt(range.start), document.offsetAt(range.end));
}

const DECLARATIVE = `pipeline {
  agent any
  environment {
    FOO = 'bar'
  }
  options { timeout(time: 1, unit: 'HOURS') }
  stages {
    stage('Build') {
      steps {
        sh 'make'
      }
    }
    stage('Test') {
      parallel {
        stage('Unit') {
          steps { sh 'make unit' }
        }
        stage("Integration \${env.SUITE}") {
          steps { sh 'make it' }
        }
      }
      post {
        failure { echo 'failed' }
        always { junit '**/*.xml' }
      }
    }
    stage('Matrix') {
      matrix {
        axes {
          axis { name 'OS'; values 'linux', 'mac' }
        }
        stages {
          stage(name) {
            steps { echo name }
          }
        }
      }
    }
  }
  post {
    success { echo 'ok' }
    cleanup { deleteDir() }
  }
}
`;

describe("JenkinsfileDocumentSymbolProvider", () => {
  it("outlines declarative sections, nested stages, and post conditions", () => {
    const { symbols } = provide(DECLARATIVE);

    assert.deepEqual(summarize(symbols), [
      {
        name: "pipeline",
        kind: SymbolKind.Package,
        children: [
          { name: "environment", kind: SymbolKind.Namespace },
          { name: "options", kind: SymbolKind.Namespace },
          {
            name: "stages",
            kind: SymbolKind.Namespace,
            children: [
              { name: "Build", kind: SymbolKind.Module },
              {
                name: "Test",
                kind: SymbolKind.Module,
                children: [
                  {
                    name: "parallel",
                    kind: SymbolKind.Namespace,
                    children: [
                      { name: "Unit", kind: SymbolKind.Module },
                      { name: "Integration ${env.SUITE}", kind: SymbolKind.Module }
                    ]
                  },
                  {
                    name: "post",
                    kind: SymbolKind.Namespace,
                    children: [
                      { name: "failure", kind: SymbolKind.Namespace },
                      { name: "always", kind: SymbolKind.Namespace }
                    ]
                  }
                ]
              },
              {
                name: "Matrix",
                kind: SymbolKind.Module,
                children: [
                  {
                    name: "matrix",
                    kind: SymbolKind.Namespace,
                    children: [
                      {
                        name: "stages",
                        kind: SymbolKind.Namespace,
                        children: [{ name: "stage(name)", kind: SymbolKind.Module }]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            name: "post",
            kind: SymbolKind.Namespace,
            children: [
              { name: "success", kind: SymbolKind.Namespace },
              { name: "cleanup", kind: SymbolKind.Namespace }
            ]
          }
        ]
      }
    ]);
    assertWellFormed(symbols);
  });

  it("uses block and name ranges for range and selectionRange", () => {
    const { document, symbols } = provide(DECLARATIVE);
    const [pipeline] = symbols;
    assert.equal(textAt(document, pipeline.selectionRange), "pipeline");
    assert.match(textAt(document, pipeline.range), /^pipeline \{[\s\S]*\}$/);

    const stages = pipeline.children[2];
    const build = stages.children[0];
    assert.equal(textAt(document, build.selectionRange), "Build");
    assert.match(textAt(document, build.range), /^stage\('Build'\) \{[\s\S]*\}$/);
    assert.equal(textAt(document, stages.selectionRange), "stages");
  });

  it("outlines scripted node and stage blocks through other blocks", () => {
    const { symbols } = provide(`node('linux') {
  checkout scm
  dir('src') {
    stage('Build') {
      if (params.FULL) {
        stage(\`deploy-\${env.BRANCH}\`) { sh 'make' }
      }
    }
  }
  stage() { echo 'empty' }
}
node {
  stage('') { echo 'blank' }
}
`);

    assert.deepEqual(summarize(symbols), [
      {
        name: "node",
        kind: SymbolKind.Module,
        detail: "linux",
        children: [
          {
            name: "Build",
            kind: SymbolKind.Module,
            children: [{ name: "stage(`deploy-${env.BRANCH}`)", kind: SymbolKind.Module }]
          },
          { name: "stage", kind: SymbolKind.Module }
        ]
      },
      {
        name: "node",
        kind: SymbolKind.Module,
        children: [{ name: "stage", kind: SymbolKind.Module }]
      }
    ]);
    assertWellFormed(symbols);
  });

  it("lists top-level methods with their parameters and nests their stages", () => {
    const { document, symbols } = provide(`def call(Map config = [:]) {
  pipeline {
    agent any
    stages {
      stage('Run') { steps { echo 'hi' } }
    }
  }
}

void notify(String channel, boolean urgent) {
  stage('Notify') { echo channel }
}

node { stage('Main') { notify('#ci', true) } }
`);

    assert.deepEqual(summarize(symbols), [
      {
        name: "call",
        kind: SymbolKind.Method,
        detail: "(Map config = [:])",
        children: [
          {
            name: "pipeline",
            kind: SymbolKind.Package,
            children: [
              {
                name: "stages",
                kind: SymbolKind.Namespace,
                children: [{ name: "Run", kind: SymbolKind.Module }]
              }
            ]
          }
        ]
      },
      {
        name: "notify",
        kind: SymbolKind.Method,
        detail: "(String channel, boolean urgent)",
        children: [{ name: "Notify", kind: SymbolKind.Module }]
      },
      {
        name: "node",
        kind: SymbolKind.Module,
        children: [{ name: "Main", kind: SymbolKind.Module }]
      }
    ]);
    assert.equal(textAt(document, symbols[1].selectionRange), "notify");
    assertWellFormed(symbols);
  });

  it("handles unclosed, partially typed files", () => {
    const text = `pipeline {
  stages {
    stage('Build') {
      steps {
        sh 'make'
    stage('Te`;
    const { document, symbols } = provide(text);

    assert.deepEqual(summarize(symbols), [
      {
        name: "pipeline",
        kind: SymbolKind.Package,
        children: [
          {
            name: "stages",
            kind: SymbolKind.Namespace,
            children: [{ name: "Build", kind: SymbolKind.Module }]
          }
        ]
      }
    ]);
    assert.deepEqual(symbols[0].range.end, document.positionAt(text.length));
    assertWellFormed(symbols);
  });

  it("never emits empty names and keeps selection inside the range", () => {
    for (const text of [
      "stage('   ') {}",
      'stage("") {',
      "stage(  ) {}",
      "node('') { stage(\n  name\n) {} }",
      "pipeline { stages { stage { } } }",
      "pipeline {",
      "{ stage('x') }",
      "stage('a",
      ""
    ]) {
      const { symbols } = provide(text);
      assertWellFormed(symbols);
    }
    const { symbols } = provide("node('') { stage(\n  name\n) {} }");
    assert.deepEqual(summarize(symbols), [
      {
        name: "node",
        kind: SymbolKind.Module,
        children: [{ name: "stage(name)", kind: SymbolKind.Module }]
      }
    ]);
  });

  it("returns no symbols when gated off", () => {
    assert.deepEqual(provide(DECLARATIVE, false, true).symbols, []);
    assert.deepEqual(provide(DECLARATIVE, true, false).symbols, []);
  });
});
