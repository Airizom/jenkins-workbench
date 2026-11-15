/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Snippet and GString fixtures. */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { JenkinsfileStepDefinition } from "../src/jenkinsfile/JenkinsfileIntelligenceTypes";
import {
  CompletionItemKind,
  documentWithCursor,
  enabledConfig,
  jenkinsfileEditorShim,
  matchingScope,
  type TestCompletionList,
  TestHover,
  TestMarkdownString,
  TestRange,
  snippetValue
} from "./helpers/jenkinsfileEditorShim";

vi.doMock("vscode", () => jenkinsfileEditorShim);

const { JenkinsfileCompletionProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileCompletionProvider"
);
const { JenkinsfileMemberHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileMemberHoverProvider"
);
const { resolveMembers } = await import("../src/jenkinsfile/globals/JenkinsfileMemberResolver");
const { JenkinsfileHoverProvider } = await import(
  "../src/validation/editor/JenkinsfileHoverProvider"
);
const { resolveMemberCompletions } = await import(
  "../src/jenkinsfile/globals/JenkinsfileGlobalVariables"
);
const { parseJenkinsfileModel } = await import("../src/jenkinsfile/model/JenkinsfileDocumentModel");
const { getPipelineGrammarEntry, resolveDeclarativeGrammar } = await import(
  "../src/jenkinsfile/declarative/JenkinsfileDeclarativeGrammar"
);

const libraryVar: JenkinsfileStepDefinition = {
  name: "deployTools",
  displayName: "deployTools",
  requiresNodeContext: false,
  isAdvanced: false,
  signatures: [],
  source: {
    kind: "sharedLibrary",
    library: "shared",
    uri: "file:///lib/vars/deployTools.groovy",
    line: 0,
    character: 0,
    members: [
      {
        name: "release",
        signatureLabel: "release(String version)",
        documentation: "Cut a release.",
        uri: "file:///lib/vars/deployTools.groovy",
        line: 3,
        character: 4
      }
    ]
  }
};

const catalog = {
  steps: new Map([
    [
      "echo",
      {
        name: "echo",
        displayName: "Print Message",
        requiresNodeContext: false,
        isAdvanced: false,
        signatures: []
      }
    ],
    ["deployTools", libraryVar]
  ]),
  directives: new Map()
};

const catalogSource = {
  getCatalogForDocument: async () => ({ kind: "fallback-no-environment", catalog })
};

const provider = new JenkinsfileCompletionProvider(
  enabledConfig as never,
  matchingScope as never,
  catalogSource as never
);

async function complete(source: string): Promise<TestCompletionList | undefined> {
  const { document, position } = documentWithCursor(source);
  return (await provider.provideCompletionItems(document as never, position as never)) as
    | TestCompletionList
    | undefined;
}

const DECLARATIVE = [
  "pipeline {",
  "  parameters {",
  "    string(name: 'TARGET', defaultValue: 'prod', description: 'Where to deploy')",
  "  }",
  "  environment {",
  "    DEPLOY_DIR = 'out'",
  "    BUILD_NUMBER = 'shadowed'",
  "  }",
  "  stages {",
  "    stage('A') {",
  "      steps {",
  "        STEP",
  "      }",
  "    }",
  "  }",
  "}"
].join("\n");

function inSteps(statement: string): string {
  return DECLARATIVE.replace("STEP", statement);
}

describe("global member completion", () => {
  it("offers declared env keys first, then bundled variables without duplicates", async () => {
    const result = await complete(inSteps("echo env./*cursor*/"));
    const items = result?.items ?? [];
    const names = items.map((item) => item.label);

    assert.deepEqual(names.slice(0, 2), ["DEPLOY_DIR", "BUILD_NUMBER"]);
    assert.equal(items[0].detail, "Declared in this file");
    assert.equal(names.filter((name) => name === "BUILD_NUMBER").length, 1);
    assert.ok(names.includes("WORKSPACE"));
    const branch = items.find((item) => item.label === "BRANCH_NAME");
    assert.equal(branch?.detail, "Environment variable (multibranch)");
    assert.equal(branch?.kind, CompletionItemKind.Property);
    assert.equal(names.includes("echo"), false);
    const start = inSteps("echo env.").indexOf("env.") + 4;
    assert.equal(items[0].range?.start.offset, start);
  });

  it("completes inside GString interpolation", async () => {
    const result = await complete(inSteps('echo "branch ${env.BR/*cursor*/}"'));
    const branch = result?.items.find((item) => item.label === "BRANCH_NAME");

    assert.ok(branch);
    const start = inSteps('echo "branch ${env.').indexOf("${env.") + 6;
    assert.equal(branch.range?.start.offset, start);
    assert.equal(branch.range?.end.offset, start + 2);
  });

  it("completes declarative and scripted params", async () => {
    const declarative = await complete(inSteps("echo params./*cursor*/"));
    assert.deepEqual(
      declarative?.items.map((item) => [item.label, item.detail]),
      [["TARGET", "string"]]
    );
    assert.equal(
      declarative?.items[0].documentation?.value,
      "Where to deploy\n\nDefault: `'prod'`"
    );

    const scripted = await complete(
      [
        "properties([parameters([booleanParam(name: 'DRY_RUN', defaultValue: true)])])",
        "node { echo params./*cursor*/ }"
      ].join("\n")
    );
    assert.deepEqual(
      scripted?.items.map((item) => [item.label, item.detail]),
      [["DRY_RUN", "booleanParam"]]
    );
  });

  it("completes currentBuild members, including method snippets", async () => {
    const result = await complete("node { currentBuild./*cursor*/ }");
    const items = result?.items ?? [];

    const resultItem = items.find((item) => item.label === "result");
    assert.equal(resultItem?.detail, "String");
    assert.equal(resultItem?.kind, CompletionItemKind.Property);
    const causes = items.find((item) => item.label === "getBuildCauses(String)");
    assert.equal(causes?.kind, CompletionItemKind.Method);
    assert.equal(causes?.filterText, "getBuildCauses");
    assert.equal(snippetValue(causes), "getBuildCauses('${1:hudson.model.Cause\\$UserIdCause}')");
    assert.ok(items.some((item) => item.label === "getBuildCauses()"));
    assert.equal(items.find((item) => item.label === "upstreamBuilds")?.detail, "List<RunWrapper>");
  });

  it("follows RunWrapper chains and stops at non-RunWrapper members", async () => {
    const chain = await complete("node { echo currentBuild.previousBuild./*cursor*/ }");
    assert.ok(chain?.items.some((item) => item.label === "durationString"));
    const safeChain = await complete(
      "node { echo currentBuild?.previousSuccessfulBuild?.nu/*cursor*/ }"
    );
    assert.ok(safeChain?.items.some((item) => item.label === "number"));

    assert.equal(await complete("node { echo currentBuild.result./*cursor*/ }"), undefined);
    assert.equal(await complete("node { echo unknown./*cursor*/ }"), undefined);
  });

  it("completes shared library var members", async () => {
    const result = await complete("node { deployTools./*cursor*/ }");

    assert.deepEqual(
      result?.items.map((item) => [item.label, item.detail, item.kind, snippetValue(item)]),
      [["release", "release(String version)", CompletionItemKind.Method, "release($0)"]]
    );
  });

  it("adds global variables and library vars to step completions", async () => {
    const result = await complete(inSteps("/*cursor*/"));
    const items = result?.items ?? [];

    for (const name of ["env", "params", "currentBuild", "scm"]) {
      assert.equal(items.find((item) => item.label === name)?.kind, CompletionItemKind.Variable);
    }
    const library = items.find((item) => item.label === "deployTools");
    assert.equal(library?.detail, "Shared library: shared");
    assert.equal(library?.sortText, "a:deployTools");
    // A var without `def call` is an object: insert the bare name, not a call.
    assert.equal(library?.kind, CompletionItemKind.Variable);
    assert.equal(library?.insertText, "deployTools");
    assert.equal(items.find((item) => item.label === "echo")?.detail, "Print Message");

    const filtered = await complete(inSteps("cur/*cursor*/"));
    assert.deepEqual(
      filtered?.items.map((item) => item.label),
      ["currentBuild"]
    );
  });

  it("offers node-only steps in shared library vars files outside a node block", async () => {
    const shStep: JenkinsfileStepDefinition = {
      name: "sh",
      displayName: "Shell Script",
      requiresNodeContext: true,
      isAdvanced: false,
      signatures: []
    };
    const createProvider = (isLibraryVarsFile: boolean) =>
      new JenkinsfileCompletionProvider(
        enabledConfig as never,
        { matches: () => true, isLibraryVarsFile: () => isLibraryVarsFile } as never,
        {
          getCatalogForDocument: async () => ({
            kind: "fallback-no-environment",
            catalog: { steps: new Map([["sh", shStep]]), directives: new Map() }
          })
        } as never
      );
    const labels = async (isLibraryVarsFile: boolean) => {
      const { document, position } = documentWithCursor("def call() {\n  s/*cursor*/\n}");
      const result = (await createProvider(isLibraryVarsFile).provideCompletionItems(
        document as never,
        position as never
      )) as TestCompletionList | undefined;
      return result?.items.map((item) => item.label) ?? [];
    };

    // Library code runs in the caller's node, so `sh` is valid inside `def call() { }`.
    assert.ok((await labels(true)).includes("sh"));
    // A plain Jenkinsfile outside `node` keeps hiding node-only steps.
    assert.ok(!(await labels(false)).includes("sh"));
  });

  it("resolves members from plain data", () => {
    const model = parseJenkinsfileModel("pipeline { environment { A = '1' } }");
    assert.equal(resolveMemberCompletions(["env"], model)[0].name, "A");
    assert.deepEqual(resolveMemberCompletions(["scm"], model), []);
    assert.deepEqual(resolveMemberCompletions(["env", "A"], model), []);
  });
});

async function hoverAt(source: string) {
  const { document, position } = documentWithCursor(source);
  const hoverProvider = new JenkinsfileMemberHoverProvider(
    enabledConfig as never,
    matchingScope as never,
    catalogSource as never
  );
  return {
    hover: (await hoverProvider.provideHover(document as never, position as never)) as
      | TestHover
      | undefined,
    text: document.getText()
  };
}

function hoverValue(hover: TestHover | undefined): string {
  const contents = hover?.contents;
  return Array.isArray(contents)
    ? contents.map((entry) => entry.value).join("\n")
    : (contents?.value ?? "");
}

describe("JenkinsfileMemberHoverProvider", () => {
  it("describes bundled env variables with the member range", async () => {
    const { hover, text } = await hoverAt("node { echo env.BUILD_NU/*cursor*/MBER }");

    assert.ok(hover);
    assert.match(hoverValue(hover), /env\.BUILD_NUMBER: String/);
    assert.match(hoverValue(hover), /current build number/);
    const start = text.indexOf("BUILD_NUMBER");
    assert.equal(hover.range?.start.offset, start);
    assert.equal(hover.range?.end.offset, start + "BUILD_NUMBER".length);
  });

  it("marks env keys declared in the file", async () => {
    const { hover } = await hoverAt(inSteps("echo env.DEPLOY/*cursor*/_DIR"));
    assert.match(hoverValue(hover), /Declared in this file/);
  });

  it("shows parameter type, description and default", async () => {
    const { hover } = await hoverAt(inSteps('echo "${params.TAR/*cursor*/GET}"'));
    const value = hoverValue(hover);

    assert.match(value, /params\.TARGET: string/);
    assert.match(value, /Where to deploy/);
    assert.match(value, /Default: `'prod'`/);
  });

  it("resolves RunWrapper chains and ignores receivers and unknown members", async () => {
    const { hover } = await hoverAt("node { echo currentBuild.previousBuild.res/*cursor*/ult }");
    assert.match(hoverValue(hover), /currentBuild\.previousBuild\.result: String/);

    const previous = (await hoverAt("node { echo currentBuild.previous/*cursor*/Build.result }"))
      .hover;
    assert.match(hoverValue(previous), /previousBuild: RunWrapper/);

    assert.equal((await hoverAt("node { echo cur/*cursor*/rentBuild.result }")).hover, undefined);
    assert.equal((await hoverAt("node { echo env.NOT_A_/*cursor*/VAR }")).hover, undefined);
    assert.equal((await hoverAt("node { echo 'env.BUILD_/*cursor*/NUMBER' }")).hover, undefined);
  });

  it("does nothing when intelligence is disabled", async () => {
    const { document, position } = documentWithCursor("echo env.BUILD_/*cursor*/NUMBER");
    const disabled = new JenkinsfileMemberHoverProvider(
      { isEnabled: () => false } as never,
      matchingScope as never,
      catalogSource as never
    );
    assert.equal(await disabled.provideHover(document as never, position as never), undefined);
  });

  it("describes shared library var members with signature, library, and docs", async () => {
    const documented = {
      ...libraryVar.source?.members[0],
      documentation: "Cut a *release*."
    } as NonNullable<JenkinsfileStepDefinition["source"]>["members"][number];
    const docSource = {
      getCatalogForDocument: async () => ({
        kind: "fallback-no-environment",
        catalog: {
          ...catalog,
          steps: new Map([
            [
              "deployTools",
              {
                ...libraryVar,
                source: { ...libraryVar.source, members: [documented] }
              }
            ]
          ])
        }
      })
    };
    const { document, position } = documentWithCursor(
      "node { deployTools.rel/*cursor*/ease('1.0') }"
    );
    const hover = (await new JenkinsfileMemberHoverProvider(
      enabledConfig as never,
      matchingScope as never,
      docSource as never
    ).provideHover(document as never, position as never)) as TestHover | undefined;

    assert.ok(hover);
    assert.equal(
      hoverValue(hover),
      "\n```groovy\ndeployTools.release(String version)\n```\n" +
        "Shared library method from shared.\n\nCut a *release*."
    );
    const start = document.getText().indexOf("release");
    assert.equal(hover.range?.start.offset, start);
    assert.equal(hover.range?.end.offset, start + "release".length);
  });

  it("ignores unknown library members and nested library receivers", async () => {
    assert.equal((await hoverAt("node { deployTools.unkn/*cursor*/own() }")).hover, undefined);
    assert.equal(
      (await hoverAt("node { config.deployTools.rel/*cursor*/ease() }")).hover,
      undefined
    );
  });
});

describe("resolveMembers", () => {
  const model = parseJenkinsfileModel("pipeline { environment { A = '1' } }");

  it("lists global members, then library var members, tagged by origin", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return catalog as never;
    };

    const env = await resolveMembers(["env"], model, load);
    assert.equal(env[0].origin, "global");
    assert.equal(env[0].name, "A");
    assert.ok(env.every((member) => member.origin === "global"));

    const library = await resolveMembers(["deployTools"], model, load);
    assert.deepEqual(library, [
      {
        origin: "sharedLibrary",
        library: "shared",
        name: "release",
        signatureLabel: "release(String version)",
        documentation: "Cut a release.",
        uri: "file:///lib/vars/deployTools.groovy",
        line: 3,
        character: 4
      }
    ]);
    assert.equal(loads, 2);
  });

  it("loads the catalog only for a single-segment receiver", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return catalog as never;
    };
    const chain = await resolveMembers(["currentBuild", "previousBuild"], model, load);
    assert.ok(chain.some((member) => member.origin === "global" && member.name === "result"));
    assert.deepEqual(await resolveMembers(["config", "deployTools"], model, load), []);
    assert.equal(loads, 0);
    assert.deepEqual(await resolveMembers(["unknown"], model, load), []);
    assert.equal(loads, 1);
  });
});

describe("JenkinsfileHoverProvider", () => {
  // `mergeHovers` measures spans by line/character; positions here sit on line 0.
  const at = (offset: number) => ({ offset, line: 0, character: offset });
  const range = (start: number, end: number) => new TestRange(at(start), at(end));
  const fixed = (hover: TestHover | undefined) => ({ provideHover: async () => hover });

  it("merges matching hovers from all providers in order", async () => {
    const composite = new JenkinsfileHoverProvider([
      fixed(new TestHover(new TestMarkdownString("first"), range(0, 10))),
      fixed(undefined),
      fixed(new TestHover([new TestMarkdownString("second")], range(2, 5))),
      fixed(new TestHover(new TestMarkdownString("elsewhere"), range(20, 30)))
    ] as never);

    const hover = (await composite.provideHover(
      {} as never,
      { offset: 3 } as never,
      {} as never
    )) as TestHover | undefined;

    assert.deepEqual(
      (hover?.contents as TestMarkdownString[] | undefined)?.map((entry) => entry.value),
      ["first", "---", "second"]
    );
    assert.equal(hover?.range?.start.offset, 2);
  });

  it("returns a single hover unchanged and undefined when nothing matches", async () => {
    const only = new TestHover(new TestMarkdownString("only"), range(0, 4));
    const single = new JenkinsfileHoverProvider([fixed(only), fixed(undefined)] as never);
    assert.equal(await single.provideHover({} as never, { offset: 1 } as never, {} as never), only);

    const none = new JenkinsfileHoverProvider([] as never);
    assert.equal(
      await none.provideHover({} as never, { offset: 1 } as never, {} as never),
      undefined
    );
  });
});

/** Unescaped `$` that does not start a tabstop or placeholder (`$1`, `${1...}`). */
function findSnippetVariables(snippet: string): string[] {
  const problems: string[] = [];
  for (let index = 0; index < snippet.length; index += 1) {
    const character = snippet[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character !== "$") {
      continue;
    }
    const next = snippet[index + 1] ?? "";
    const isTabstop = /\d/.test(next) || (next === "{" && /\d/.test(snippet[index + 2] ?? ""));
    if (!isTabstop) {
      problems.push(snippet.slice(index, index + 20));
    }
  }
  return problems;
}

describe("bundled snippets", () => {
  const GRAMMAR_CONTEXTS = [
    "root",
    "pipeline",
    "stages",
    "parallel",
    "stage",
    "matrix",
    "axes",
    "axis",
    "excludes",
    "exclude",
    "post",
    "agent",
    "when",
    "options",
    "triggers",
    "parameters",
    "tools",
    "libraries",
    "input"
  ];

  it("escapes every literal $ in grammar and global member snippets", () => {
    const snippets = new Map<string, string>();
    snippets.set("pipeline", getPipelineGrammarEntry().snippet);
    for (const context of GRAMMAR_CONTEXTS) {
      const grammar = resolveDeclarativeGrammar(context, ["pipeline"]);
      assert.ok(grammar, context);
      for (const entry of grammar.entries) {
        snippets.set(`${context}/${entry.name}`, entry.snippet);
      }
    }
    const model = parseJenkinsfileModel("");
    for (const receiver of [["env"], ["params"], ["currentBuild"]]) {
      for (const member of resolveMemberCompletions(receiver, model)) {
        if (member.snippet) {
          snippets.set(`${receiver.join(".")}.${member.label}`, member.snippet);
        }
      }
    }

    assert.ok(snippets.size > 50);
    assert.ok(snippets.has("currentBuild.getBuildCauses(String)"));
    const problems = [...snippets]
      .map(([name, snippet]) => [name, findSnippetVariables(snippet)] as const)
      .filter(([, found]) => found.length > 0);
    assert.deepEqual(problems, []);
    assert.deepEqual(findSnippetVariables("x('${1:a$B}')"), ["$B}')"]);
  });
});
