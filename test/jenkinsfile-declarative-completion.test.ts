/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Snippet and GString fixtures. */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsfileStepDefinition } from "../src/jenkinsfile/JenkinsfileIntelligenceTypes";
import {
  CompletionItemKind,
  CompletionTriggerKind,
  documentWithCursor,
  enabledConfig,
  jenkinsfileEditorShim,
  matchingScope,
  type TestCompletionList,
  snippetValue
} from "./helpers/jenkinsfileEditorShim";

vi.doMock("vscode", () => jenkinsfileEditorShim);

const { JenkinsfileCompletionProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileCompletionProvider"
);
const { isInsideStringOrComment, parseJenkinsfileModel } = await import(
  "../src/jenkinsfile/model/JenkinsfileDocumentModel"
);
const { resolveDeclarativeGrammar } = await import(
  "../src/jenkinsfile/declarative/JenkinsfileDeclarativeGrammar"
);

function step(name: string, overrides: Partial<JenkinsfileStepDefinition> = {}) {
  return {
    name,
    displayName: name,
    requiresNodeContext: false,
    isAdvanced: false,
    signatures: [],
    ...overrides
  } satisfies JenkinsfileStepDefinition;
}

const STEPS = new Map([
  ["echo", step("echo")],
  ["sh", step("sh")]
]);

function createProvider(
  options: {
    directives?: Map<string, Map<string, JenkinsfileStepDefinition>>;
    librarySource?: unknown;
  } = {}
) {
  return new JenkinsfileCompletionProvider(
    enabledConfig as never,
    matchingScope as never,
    {
      getCatalogForDocument: async () => ({
        kind: "fallback-no-environment",
        catalog: { steps: STEPS, directives: options.directives ?? new Map() }
      })
    } as never,
    options.librarySource as never
  );
}

async function complete(
  source: string,
  provider = createProvider()
): Promise<TestCompletionList | undefined> {
  const { document, position } = documentWithCursor(source);
  return (await provider.provideCompletionItems(document as never, position as never)) as
    | TestCompletionList
    | undefined;
}

async function labels(source: string, provider = createProvider()): Promise<string[]> {
  return ((await complete(source, provider))?.items ?? []).map((item) => item.label);
}

function pipeline(...lines: string[]): string {
  return ["pipeline {", ...lines, "}"].join("\n");
}

describe("declarative grammar completion", () => {
  it("offers pipeline sections and hides singletons already present", async () => {
    const result = await labels(
      pipeline(
        "  agent any",
        "  /*cursor*/",
        "  stages {",
        "    stage('A') { steps { echo 'a' } }",
        "  }"
      )
    );

    assert.deepEqual(result.sort(), [
      "environment",
      "libraries",
      "options",
      "parameters",
      "post",
      "tools",
      "triggers"
    ]);
  });

  it("offers only stage inside stages and parallel", async () => {
    assert.deepEqual(await labels(pipeline("  stages {", "    /*cursor*/", "  }")), ["stage"]);
    assert.deepEqual(
      await labels(
        pipeline(
          "  stages {",
          "    stage('P') {",
          "      parallel {",
          "        /*cursor*/",
          "      }",
          "    }",
          "  }"
        )
      ),
      ["stage"]
    );
  });

  it("offers stage directives with snippets and keyword/property kinds", async () => {
    const result = await complete(
      pipeline(
        "  stages {",
        "    stage('A') {",
        "      when { branch 'main' }",
        "      /*cursor*/",
        "    }",
        "  }"
      )
    );
    const names = result?.items.map((item) => item.label) ?? [];

    assert.ok(names.includes("steps"));
    assert.ok(names.includes("matrix"));
    assert.ok(names.includes("failFast"));
    assert.equal(names.includes("when"), false);
    assert.equal(names.includes("echo"), false);
    const steps = result?.items.find((item) => item.label === "steps");
    assert.equal(steps?.kind, CompletionItemKind.Keyword);
    assert.equal(snippetValue(steps), "steps {\n\t$0\n}");
    const failFast = result?.items.find((item) => item.label === "failFast");
    assert.equal(failFast?.kind, CompletionItemKind.Property);
  });

  it("offers the stages entry with a stage snippet", async () => {
    const result = await complete(pipeline("  /*cursor*/"));
    const stage = (await complete(pipeline("  stages {", "    /*cursor*/", "  }")))?.items.find(
      (item) => item.label === "stage"
    );

    assert.ok(result?.items.some((item) => item.label === "stages"));
    assert.equal(snippetValue(stage), "stage('${1:Name}') {\n\tsteps {\n\t\t$0\n\t}\n}");
  });

  it("offers post conditions only inside post and steps inside a condition", async () => {
    const inPost = await labels(
      pipeline("  post {", "    always { echo 'x' }", "    /*cursor*/", "  }")
    );
    const inCondition = await labels(
      pipeline("  post {", "    failure {", "      /*cursor*/", "    }", "  }")
    );
    const inPipeline = await labels(pipeline("  /*cursor*/"));

    assert.ok(inPost.includes("failure"));
    assert.ok(inPost.includes("cleanup"));
    assert.equal(inPost.includes("always"), false);
    assert.equal(inPost.includes("echo"), false);
    assert.ok(inCondition.includes("echo"));
    assert.equal(inCondition.includes("failure"), false);
    assert.equal(inPipeline.includes("failure"), false);
  });

  it("treats stage-level post like pipeline post", async () => {
    const result = await labels(
      pipeline(
        "  stages {",
        "    stage('A') {",
        "      post {",
        "        /*cursor*/",
        "      }",
        "    }",
        "  }"
      )
    );
    assert.ok(result.includes("success"));
  });

  it("offers options without steps and hides options already used", async () => {
    const result = await complete(
      pipeline("  options {", "    timestamps()", "    /*cursor*/", "  }")
    );
    const names = result?.items.map((item) => item.label) ?? [];

    assert.ok(names.includes("timeout"));
    assert.equal(names.includes("timestamps"), false);
    assert.equal(names.includes("echo"), false);
    const timeout = result?.items.find((item) => item.label === "timeout");
    assert.equal(snippetValue(timeout), "timeout(time: ${1:1}, unit: '${2:HOURS}')");
  });

  it("offers when conditions, nested without evaluation-order flags", async () => {
    const top = await labels(
      pipeline(
        "  stages {",
        "    stage('A') {",
        "      when {",
        "        /*cursor*/",
        "      }",
        "    }",
        "  }"
      )
    );
    const nested = await labels(
      pipeline(
        "  stages {",
        "    stage('A') {",
        "      when {",
        "        allOf {",
        "          /*cursor*/",
        "        }",
        "      }",
        "    }",
        "  }"
      )
    );

    assert.ok(top.includes("branch"));
    assert.ok(top.includes("beforeAgent"));
    assert.equal(top.includes("echo"), false);
    assert.ok(nested.includes("branch"));
    assert.ok(nested.includes("not"));
    assert.equal(nested.includes("beforeAgent"), false);
  });

  it("covers agent, triggers, parameters, tools, libraries and matrix contexts", async () => {
    assert.ok((await labels(pipeline("  agent {", "    /*cursor*/", "  }"))).includes("docker"));
    assert.deepEqual((await labels(pipeline("  triggers {", "    /*cursor*/", "  }"))).sort(), [
      "cron",
      "pollSCM",
      "upstream"
    ]);
    assert.ok(
      (await labels(pipeline("  parameters {", "    /*cursor*/", "  }"))).includes("booleanParam")
    );
    assert.deepEqual((await labels(pipeline("  tools {", "    /*cursor*/", "  }"))).sort(), [
      "gradle",
      "jdk",
      "maven"
    ]);
    assert.deepEqual(await labels(pipeline("  libraries {", "    /*cursor*/", "  }")), ["lib"]);
    const matrix = pipeline(
      "  stages {",
      "    stage('M') {",
      "      matrix {",
      "        axes {",
      "          axis {",
      "            name 'OS'",
      "            /*cursor*/",
      "          }",
      "        }",
      "      }",
      "    }",
      "  }"
    );
    assert.deepEqual(await labels(matrix), ["values"]);
    assert.deepEqual(await labels(pipeline("  environment {", "    /*cursor*/", "  }")), []);
  });

  it("offers pipeline at the root only when the file has none", async () => {
    const empty = await complete("/*cursor*/");
    const withPipeline = await labels("/*cursor*/\npipeline {\n}");

    const pipelineItem = empty?.items.find((item) => item.label === "pipeline");
    assert.equal(pipelineItem?.kind, CompletionItemKind.Keyword);
    assert.ok(empty?.items.some((item) => item.label === "echo"));
    assert.equal(withPipeline.includes("pipeline"), false);
    assert.ok(withPipeline.includes("echo"));
  });

  it("filters by the partial word and replaces it", async () => {
    const result = await complete(pipeline("  opt/*cursor*/"));
    const options = result?.items.find((item) => item.label === "options");

    assert.ok(options);
    assert.equal(options.range?.start.offset, "pipeline {\n  ".length);
    assert.equal(options.range?.end.offset, "pipeline {\n  opt".length);
  });

  it("lets live GDSL directives replace bundled entries of the same name", async () => {
    const directives = new Map([
      [
        "options",
        new Map([
          [
            "timeout",
            step("timeout", {
              displayName: "Live timeout",
              documentation: "From the controller",
              signatures: [
                {
                  label: "timeout(time: int)",
                  parameters: [{ name: "time", type: "int" }],
                  usesNamedArgs: true,
                  takesClosure: false
                }
              ]
            })
          ],
          ["lock", step("lock")]
        ])
      ]
    ]);
    const result = await complete(
      pipeline("  options {", "    /*cursor*/", "  }"),
      createProvider({ directives })
    );
    const timeouts = result?.items.filter((item) => item.label === "timeout") ?? [];

    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].detail, "Live timeout");
    assert.equal(timeouts[0].kind, CompletionItemKind.Property);
    assert.equal(snippetValue(timeouts[0]), "timeout(${time}: ${value})");
    assert.ok(result?.items.some((item) => item.label === "lock"));
    assert.ok(result?.items.some((item) => item.label === "timestamps"));
  });

  it("returns nothing inside strings and comments", async () => {
    assert.equal(await complete("node {\n  echo 'pi/*cursor*/'\n}"), undefined);
    assert.equal(await complete("node {\n  // pi/*cursor*/\n}"), undefined);
    assert.equal(await complete(pipeline("  /* opt/*cursor*/ */")), undefined);
  });

  it("completes library names inside @Library strings", async () => {
    const librarySource = {
      getLibraries: async () => [
        {
          name: "shared",
          rootUri: "file:///work/shared",
          implicit: false,
          configured: true,
          varNames: ["deploy"]
        },
        {
          name: "global",
          rootUri: "file:///work/global",
          implicit: true,
          configured: true,
          varNames: []
        }
      ]
    };
    const provider = createProvider({ librarySource });

    const fresh = await complete("@Library('/*cursor*/", provider);
    assert.deepEqual(
      fresh?.items.map((item) => [item.label, item.detail, item.kind]),
      [
        ["shared", "/work/shared", CompletionItemKind.Module],
        ["global", "Implicit", CompletionItemKind.Module]
      ]
    );

    const partial = await complete("@Library('sha/*cursor*/@v1') _", provider);
    const range = partial?.items[0].range;
    assert.equal(range?.start.offset, "@Library('".length);
    assert.equal(range?.end.offset, "@Library('sha".length);

    assert.equal(await complete("@Library('shared@/*cursor*/') _", provider), undefined);
    assert.equal(await complete("@Library('/*cursor*/') _"), undefined);
  });

  it("completes library names inside lib(...) in a libraries directive", async () => {
    const librarySource = {
      getLibraries: async () => [
        {
          name: "shared",
          rootUri: "file:///work/shared",
          implicit: false,
          configured: true,
          varNames: []
        }
      ]
    };
    const provider = createProvider({ librarySource });
    const source = pipeline("  libraries {", "    lib('/*cursor*/')", "  }");

    const result = await complete(source, provider);
    assert.deepEqual(
      result?.items.map((item) => item.label),
      ["shared"]
    );
    const offset = source.indexOf("/*cursor*/");
    assert.equal(result?.items[0].range?.start.offset, offset);
    assert.equal(result?.items[0].range?.end.offset, offset);
  });

  describe("trigger characters", () => {
    const librarySource = {
      getLibraries: async () => [
        {
          name: "shared",
          rootUri: "file:///work/shared",
          implicit: false,
          configured: true,
          varNames: []
        }
      ]
    };

    async function triggered(
      source: string,
      character: string
    ): Promise<TestCompletionList | undefined> {
      const { document, position } = documentWithCursor(source);
      const provider = createProvider({ librarySource });
      return (await provider.provideCompletionItems(
        document as never,
        position as never,
        {} as never,
        {
          triggerKind: CompletionTriggerKind.TriggerCharacter,
          triggerCharacter: character
        } as never
      )) as TestCompletionList | undefined;
    }

    it("does not list steps after a quote closes a string", async () => {
      for (const source of [
        "node {\n  def x = 'abc'/*cursor*/\n}",
        "node {\n  if (params.A == 'yes'/*cursor*/) {}\n}",
        "node {\n  env.FOO = 'bar'/*cursor*/\n}",
        "def helper() {\n  return 'x'/*cursor*/\n}",
        'node {\n  def y = "abc"/*cursor*/\n}'
      ]) {
        const quote = source.includes('"abc"') ? '"' : "'";
        assert.equal(await triggered(source, quote), undefined, source);
      }
      // Invoked completion at the same place keeps its existing behaviour.
      assert.ok((await labels("node {\n  def x = 'abc'/*cursor*/\n}")).includes("echo"));
    });

    it("opens only library names on a quote and only members on a dot", async () => {
      const library = await triggered("@Library('/*cursor*/') _", "'");
      assert.deepEqual(
        library?.items.map((item) => item.label),
        ["shared"]
      );
      assert.equal(await triggered("node {\n  echo '/*cursor*/'\n}", "'"), undefined);

      const members = await triggered("node {\n  echo env./*cursor*/\n}", ".");
      assert.ok(members?.items.some((item) => item.label === "BUILD_NUMBER"));
      assert.equal(await triggered("node {\n  def v = 1./*cursor*/\n}", "."), undefined);
      assert.equal(await triggered("node {\n  echo 'a./*cursor*/'\n}", "."), undefined);
    });
  });
});

describe("grammar helpers", () => {
  it("detects strings and comments while treating interpolation as code", () => {
    const at = (source: string) => {
      const offset = source.indexOf("|");
      return isInsideStringOrComment(parseJenkinsfileModel(source.replace("|", "")), offset);
    };
    assert.equal(at("echo 'a|'"), true);
    assert.equal(at('echo "a|"'), true);
    assert.equal(at('echo "${env.B|}"'), false);
    assert.equal(at("// note|"), true);
    assert.equal(at("/* a| */ x"), true);
    assert.equal(at("echo 'a' |"), false);
    assert.equal(at("echo '''a\nb|'''"), true);
  });

  it("returns no grammar for step blocks", () => {
    assert.equal(
      resolveDeclarativeGrammar("steps", ["pipeline", "stages", "stage", "steps"]),
      undefined
    );
    assert.equal(resolveDeclarativeGrammar("allOf", ["pipeline", "allOf"])?.key, undefined);
    assert.equal(resolveDeclarativeGrammar("allOf", ["pipeline", "when", "allOf"])?.key, "when");
  });
});
