/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: Groovy GString fixtures. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { maskGroovyText } from "../src/jenkinsfile/context/JenkinsfileGroovyTextMasker";
import {
  findEnclosingCallSpan,
  findInnermostBlock,
  findLibraryRefAt,
  getBlockAncestors,
  isInsideInterpolation,
  isInsideStringOrComment,
  parseJenkinsfileModel
} from "../src/jenkinsfile/model/JenkinsfileDocumentModel";
import { getJenkinsfileDocumentModel } from "../src/jenkinsfile/model/JenkinsfileDocumentModelCache";
import type {
  JenkinsfileBlock,
  JenkinsfileDocumentModel
} from "../src/jenkinsfile/model/JenkinsfileDocumentModelTypes";

interface BlockSummary {
  label?: string;
  name?: string;
  children?: BlockSummary[];
}

function summarize(blocks: JenkinsfileBlock[]): BlockSummary[] {
  return blocks.map((block) => {
    const summary: BlockSummary = {};
    if (block.label !== undefined) {
      summary.label = block.label;
    }
    if (block.name !== undefined) {
      summary.name = block.name;
    }
    if (block.children.length > 0) {
      summary.children = summarize(block.children);
    }
    return summary;
  });
}

function slice(model: JenkinsfileDocumentModel, range: { start: number; end: number }): string {
  return model.text.slice(range.start, range.end);
}

function libraryRefs(text: string) {
  return parseJenkinsfileModel(text).libraryRefs.map((ref) => ({
    name: ref.name,
    ref: ref.ref,
    source: ref.source,
    content: text.slice(ref.range.start, ref.range.end),
    nameText: text.slice(ref.nameRange.start, ref.nameRange.end)
  }));
}

describe("parseJenkinsfileModel blocks", () => {
  it("builds the declarative tree with stages, parallel and matrix nesting", () => {
    const text = [
      "pipeline {",
      "  agent any",
      "  stages {",
      "    stage('Build') {",
      "      steps { sh 'make' }",
      "    }",
      "    stage('Tests') {",
      "      parallel {",
      "        stage('Unit') { steps { echo 'u' } }",
      "        stage('Matrix') {",
      "          matrix {",
      "            axes { axis { name 'OS'; values 'linux' } }",
      "            stages { stage('Cell') { steps { echo 'c' } } }",
      "          }",
      "        }",
      "      }",
      "    }",
      "  }",
      "  post { always { echo 'done' } }",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(summarize(model.blocks), [
      {
        label: "pipeline",
        children: [
          {
            label: "stages",
            children: [
              { label: "stage", name: "Build", children: [{ label: "steps" }] },
              {
                label: "stage",
                name: "Tests",
                children: [
                  {
                    label: "parallel",
                    children: [
                      { label: "stage", name: "Unit", children: [{ label: "steps" }] },
                      {
                        label: "stage",
                        name: "Matrix",
                        children: [
                          {
                            label: "matrix",
                            children: [
                              { label: "axes", children: [{ label: "axis" }] },
                              {
                                label: "stages",
                                children: [
                                  { label: "stage", name: "Cell", children: [{ label: "steps" }] }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          { label: "post", children: [{ label: "always" }] }
        ]
      }
    ]);
    const pipeline = model.blocks[0];
    assert.equal(model.pipelineBlock, pipeline);
    assert.equal(pipeline.headerStart, 0);
    assert.equal(pipeline.openBrace, text.indexOf("{"));
    assert.equal(pipeline.closeBrace, text.length - 1);
    assert.equal(pipeline.closed, true);

    const build = pipeline.children[0].children[0];
    assert.equal(build.headerStart, text.indexOf("stage('Build')"));
    assert.equal(build.nameKind, "literal");
    assert.equal(slice(model, build.nameRange ?? { start: 0, end: 0 }), "Build");
  });

  it("reads stage names from every string form and from expressions", () => {
    const text = [
      "pipeline { stages {",
      "  stage('Single') {}",
      '  stage("Double") {}',
      '  stage("Build ${env.X}") {}',
      "  stage('''Triple''') {}",
      "  stage(name) {}",
      "  stage(env.STAGE_NAME) {}",
      "  stage('a' + suffix) {}",
      "  stage() {}",
      "} }"
    ].join("\n");
    const model = parseJenkinsfileModel(text);
    const stages = model.blocks[0].children[0].children;

    assert.deepEqual(
      stages.map((stage) => [stage.name, stage.nameKind]),
      [
        ["Single", "literal"],
        ["Double", "literal"],
        ["Build ${env.X}", "gstring"],
        ["Triple", "literal"],
        ["name", "expression"],
        ["env.STAGE_NAME", "expression"],
        ["'a' + suffix", "expression"],
        [undefined, undefined]
      ]
    );
    for (const stage of stages) {
      if (stage.nameRange && stage.nameKind !== "expression") {
        assert.equal(slice(model, stage.nameRange), stage.name);
      }
    }
    assert.equal(slice(model, stages[5].nameRange ?? { start: 0, end: 0 }), "env.STAGE_NAME");
  });

  it("handles scripted pipelines and unlabelled closures", () => {
    const text = [
      "node('linux') {",
      "  stage('a') {}",
      "  def run = { echo 'x' }",
      "  [a: { echo 'y' }]",
      "  dir('sub') { script { sh 'ls' } }",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(summarize(model.blocks), [
      {
        label: "node",
        name: "linux",
        children: [
          { label: "stage", name: "a" },
          {},
          {},
          { label: "dir", name: "sub", children: [{ label: "script" }] }
        ]
      }
    ]);
    const closure = model.blocks[0].children[1];
    assert.equal(closure.headerStart, closure.openBrace);
    assert.equal(model.pipelineBlock, undefined);
  });

  it("closes unclosed braces at EOF and ignores stray closing braces", () => {
    const text = "}\npipeline {\n  stages {\n    stage('x') {\n";
    const model = parseJenkinsfileModel(text);

    assert.equal(model.blocks.length, 1);
    const stage = model.blocks[0].children[0].children[0];
    assert.equal(stage.name, "x");
    for (const block of [model.blocks[0], model.blocks[0].children[0], stage]) {
      assert.equal(block.closed, false);
      assert.equal(block.closeBrace, text.length);
    }
  });

  it("ignores braces inside comments and strings", () => {
    const text = [
      "// pipeline {",
      "/* stage('x') { */",
      "node {",
      "  echo 'a { b'",
      '  echo """{',
      '  }}}"""',
      "  sh '''",
      "    if [ x ]; then { echo; }",
      "  '''",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(summarize(model.blocks), [{ label: "node" }]);
    assert.equal(model.blocks[0].closed, true);
    assert.equal(model.blocks[0].closeBrace, text.length - 1);
  });

  it("does not create blocks for GString interpolation", () => {
    const text = [
      "node {",
      "  echo \"${items.collect { it.name }.join(',')}\"",
      '  stage("Deploy ${env.TARGET}") { echo "${x}" }',
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(summarize(model.blocks), [
      { label: "node", children: [{ label: "stage", name: "Deploy ${env.TARGET}" }] }
    ]);
    assert.equal(model.blocks[0].closed, true);
  });
});

describe("parseJenkinsfileModel statement heads", () => {
  const headNames = (block: { statementHeads: Array<{ name: string }> }) =>
    block.statementHeads.map((head) => head.name);

  it("records child block labels and bare statements directly inside a block", () => {
    const text = [
      "pipeline {",
      "  agent any",
      "  options {",
      "    timestamps()",
      "    timeout(time: 1, unit: 'HOURS')",
      "  }",
      "  stages { stage('x') { steps { echo 'a' } } }",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);
    const [pipeline] = model.blocks;
    const [options, stages] = pipeline.children;

    assert.deepEqual(headNames(model), ["pipeline"]);
    assert.deepEqual(headNames(pipeline), ["agent", "options", "stages"]);
    assert.deepEqual(headNames(options), ["timestamps", "timeout"]);
    assert.deepEqual(headNames(stages), ["stage"]);
    const [agent] = pipeline.statementHeads;
    assert.equal(text.slice(agent.start, agent.end), "agent");
  });

  it("splits statements on `;` and newlines but not inside parentheses or brackets", () => {
    const model = parseJenkinsfileModel(
      [
        "node {",
        "  a(); b c; d",
        "  sh(script: 'x',",
        "    returnStdout: true) trailing",
        "  def list = [",
        "    first,",
        "    second",
        "  ]; after",
        "  call(x; y)",
        "}"
      ].join("\n")
    );
    assert.deepEqual(headNames(model.blocks[0]), ["a", "b", "d", "sh", "def", "after", "call"]);
  });

  it("keeps nested block statements out of the parent", () => {
    const model = parseJenkinsfileModel(
      "node {\n  stage('a') {\n    echo 'x'\n    sh 'y'\n  } after\n  last\n}\ntop()"
    );
    const [node] = model.blocks;
    assert.deepEqual(headNames(model), ["node", "top"]);
    // A closing brace ends a statement, as in `} else {`.
    assert.deepEqual(headNames(node), ["stage", "after", "last"]);
    assert.deepEqual(headNames(node.children[0]), ["echo", "sh"]);
  });

  it("starts statements in closure arguments and ignores interpolation code", () => {
    const model = parseJenkinsfileModel('node {\n  foo(body: { inner })\n  echo "${x}" more\n}');
    const [node] = model.blocks;
    assert.deepEqual(headNames(node), ["foo", "echo"]);
    assert.deepEqual(headNames(node.children[0]), ["inner"]);
  });
});

describe("findInnermostBlock and getBlockAncestors", () => {
  const text = "pipeline {\n  stages {\n    stage('A') {\n      steps { }\n    }\n  }\n}\n";
  const model = parseJenkinsfileModel(text);

  it("finds the innermost block containing an offset", () => {
    const insideSteps = text.indexOf("steps {") + "steps {".length + 1;
    assert.equal(findInnermostBlock(model, insideSteps)?.label, "steps");
    assert.deepEqual(
      getBlockAncestors(model, insideSteps).map((block) => block.label),
      ["pipeline", "stages", "stage", "steps"]
    );
  });

  it("treats the opening brace as outside and the closing brace as inside", () => {
    const pipeline = model.blocks[0];
    assert.equal(findInnermostBlock(model, pipeline.openBrace), undefined);
    assert.equal(findInnermostBlock(model, pipeline.openBrace + 1), pipeline);
    assert.equal(findInnermostBlock(model, pipeline.closeBrace), pipeline);
    assert.equal(findInnermostBlock(model, pipeline.closeBrace + 1), undefined);
    assert.deepEqual(getBlockAncestors(model, 0), []);
  });

  it("treats unclosed blocks as running to EOF", () => {
    const unclosed = parseJenkinsfileModel("pipeline {\n  stages {\n");
    assert.deepEqual(
      getBlockAncestors(unclosed, unclosed.text.length).map((block) => block.label),
      ["pipeline", "stages"]
    );
  });

  it("picks the right sibling", () => {
    const siblings = parseJenkinsfileModel("a {}\nb { c {} }\nd {}\n");
    const offset = siblings.text.indexOf("c {") + 3;
    assert.deepEqual(
      getBlockAncestors(siblings, offset).map((block) => block.label),
      ["b", "c"]
    );
    assert.equal(findInnermostBlock(siblings, siblings.text.indexOf("d {") + 3)?.label, "d");
  });
});

describe("isInsideStringOrComment", () => {
  /** Reference definition: a code character typed at `offset` would be masked. */
  function remaskPrefix(text: string, offset: number): boolean {
    const masked = maskGroovyText(`${text.slice(0, offset)}x`);
    return masked[masked.length - 1] !== "x";
  }

  it("matches re-masking the text before every offset", () => {
    const texts = [
      `echo 'a' "b \${env.X ?: 'y'} c" // note\nsh '''x\\'''y''' + """q"""`,
      "a / b // c\n/ re /\nx = /a\\/b/ + $/a$$b$/c/$ + $/x${y}/$ + /x${y}z/",
      "def v = n \\\n / 2 \\\r\n / 3 /* x *\\/ */ return /a/; y = a/*b*/c",
      `z = "\${ "inner \${ 'q' } " }"; '' "" '''`,
      "'\\",
      '"${',
      "$/ open",
      "/* open",
      "// open"
    ];
    for (const text of texts) {
      const model = parseJenkinsfileModel(text);
      for (let offset = 0; offset <= text.length; offset += 1) {
        assert.equal(
          isInsideStringOrComment(model, offset),
          remaskPrefix(text, offset),
          `${JSON.stringify(text.slice(0, offset))} | ${JSON.stringify(text.slice(offset))}`
        );
      }
    }
  });

  it("treats closing delimiters and interpolated code as code", () => {
    const at = (marked: string) => {
      const offset = marked.indexOf("|");
      return isInsideStringOrComment(parseJenkinsfileModel(marked.replace("|", "")), offset);
    };
    assert.equal(at("echo 'a|'"), true);
    assert.equal(at("echo 'a'|"), false);
    assert.equal(at('echo "${env.B|}"'), false);
    assert.equal(at('echo "${env.B}|"'), true);
    assert.equal(at("// note|\nx"), true);
    assert.equal(at("// note\n|x"), false);
    assert.equal(at("echo 'open|"), true);
  });
});

describe("parseJenkinsfileModel call spans", () => {
  const spans = (text: string) =>
    parseJenkinsfileModel(text).callSpans.map((span) => [
      span.name,
      text.slice(span.openParen, span.closeParen + 1),
      span.closed
    ]);

  it("records named and grouping parentheses, including those in interpolations", () => {
    assert.deepEqual(spans('foo(a, (b), bar(c)) "${x(1)}"'), [
      ["foo", "(a, (b), bar(c))", true],
      [undefined, "(b)", true],
      ["bar", "(c)", true],
      ["x", "(1)", true]
    ]);
  });

  it("ends parens left open at the closing brace of their block, or at EOF", () => {
    const text = "node {\n  sh(\n}\ntimeout(5";
    const model = parseJenkinsfileModel(text);
    const [sh, timeout] = model.callSpans;
    assert.deepEqual([sh.name, sh.closeParen, sh.closed], ["sh", text.indexOf("}"), false]);
    assert.deepEqual(
      [timeout.name, timeout.closeParen, timeout.closed],
      ["timeout", text.length, false]
    );
    assert.equal(findEnclosingCallSpan(model, text.indexOf("}")), sh);
    assert.equal(findEnclosingCallSpan(model, text.indexOf("}") + 1), undefined);
    assert.equal(findEnclosingCallSpan(model, text.length), timeout);
  });
});

describe("isInsideInterpolation", () => {
  it("is true from after `${` through its closing brace", () => {
    const text = 'node { echo "a ${env.X} b" }';
    const model = parseJenkinsfileModel(text);
    const open = text.indexOf("${") + 1;
    const close = text.indexOf("}");
    assert.deepEqual(model.interpolations, [{ openBrace: open, closeBrace: close }]);
    assert.equal(isInsideInterpolation(model, open), false);
    assert.equal(isInsideInterpolation(model, open + 1), true);
    assert.equal(isInsideInterpolation(model, close), true);
    assert.equal(isInsideInterpolation(model, close + 1), false);
  });

  it("runs an unclosed interpolation to EOF unless a later block holds the offset", () => {
    const text = 'node { echo "${\nstage("x") {\n';
    const model = parseJenkinsfileModel(text);
    assert.equal(model.interpolations[0].closeBrace, text.length);
    assert.equal(isInsideInterpolation(model, text.indexOf("${") + 2), true);
    assert.equal(isInsideInterpolation(model, text.length), false);
  });
});

describe("parseJenkinsfileModel environment keys", () => {
  it("collects keys from environment blocks, withEnv and env assignments", () => {
    const text = [
      "pipeline {",
      "  environment {",
      "    APP_NAME = 'demo'",
      '    TOKEN = credentials("tok")',
      "    // COMMENTED = 'x'",
      "    if (FOO == 'x') {}",
      "  }",
      "  stages { stage('a') { steps {",
      "    withEnv(['MODE=fast', \"TAG=${env.BUILD_ID}\", 'BROKEN']) {",
      "      script {",
      "        env.DYNAMIC = 'yes'",
      "        if (env.CHECK == 'x') {}",
      "        env.MATCH =~ /re/",
      "        foo.env.NOT_ENV = 'x'",
      "      }",
      "    }",
      "  } } }",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(
      model.environmentKeys.map((key) => [key.name, key.source, slice(model, key.range)]),
      [
        ["APP_NAME", "environment", "APP_NAME"],
        ["TOKEN", "environment", "TOKEN"],
        ["MODE", "withEnv", "MODE"],
        ["TAG", "withEnv", "TAG"],
        ["DYNAMIC", "assignment", "DYNAMIC"]
      ]
    );
  });

  it("supports single-line environment blocks", () => {
    const model = parseJenkinsfileModel("pipeline { environment { A = '1'; B = '2' } }");
    assert.deepEqual(
      model.environmentKeys.map((key) => key.name),
      ["A", "B"]
    );
  });
});

describe("parseJenkinsfileModel parameters", () => {
  it("collects declarative parameters", () => {
    const text = [
      "pipeline {",
      "  parameters {",
      "    string(name: 'BRANCH', defaultValue: 'main', description: 'Branch to build')",
      '    booleanParam(name: "DRY_RUN", defaultValue: false)',
      "    choice(name: 'ENV', choices: ['dev', 'prod'], description: \"Target\")",
      "    text(description: 'no name')",
      "  }",
      "}"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(
      model.parameters.map(({ range, ...rest }) => ({ ...rest, rangeText: slice(model, range) })),
      [
        {
          name: "BRANCH",
          type: "string",
          description: "Branch to build",
          defaultValue: "'main'",
          rangeText: "BRANCH"
        },
        {
          name: "DRY_RUN",
          type: "booleanParam",
          description: undefined,
          defaultValue: "false",
          rangeText: "DRY_RUN"
        },
        {
          name: "ENV",
          type: "choice",
          description: "Target",
          defaultValue: "['dev', 'prod']",
          rangeText: "ENV"
        }
      ]
    );
  });

  it("collects scripted properties parameters", () => {
    const text = [
      "properties([",
      "  buildDiscarder(logRotator(numToKeepStr: '5')),",
      "  parameters([",
      "    string(name: 'VERSION', defaultValue: '1.0'),",
      "    booleanParam(name: 'SKIP', defaultValue: true, description: 'Skip tests'),",
      "    password(name: 'SECRET')",
      "  ])",
      "])",
      "node { echo params.VERSION }"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(
      model.parameters.map((parameter) => [
        parameter.name,
        parameter.type,
        parameter.defaultValue,
        parameter.description
      ]),
      [
        ["VERSION", "string", "'1.0'", undefined],
        ["SKIP", "booleanParam", "true", "Skip tests"],
        ["SECRET", "password", undefined, undefined]
      ]
    );
  });
});

describe("parseJenkinsfileModel library refs", () => {
  it("reads every @Library annotation form", () => {
    assert.deepEqual(libraryRefs("@Library('a@ref') _"), [
      { name: "a", ref: "ref", source: "annotation", content: "a@ref", nameText: "a" }
    ]);
    assert.deepEqual(libraryRefs('@Library("a") _'), [
      { name: "a", ref: undefined, source: "annotation", content: "a", nameText: "a" }
    ]);
    assert.deepEqual(
      libraryRefs("@Library(['a', 'b@v2']) _").map((ref) => [ref.name, ref.ref]),
      [
        ["a", undefined],
        ["b", "v2"]
      ]
    );
    assert.deepEqual(
      libraryRefs("@Library(value = 'a', changelog = false) _").map((ref) => ref.name),
      ["a"]
    );
    assert.deepEqual(
      libraryRefs("@Library(value = ['a','b'], changelog = false) _").map((ref) => ref.name),
      ["a", "b"]
    );
    assert.deepEqual(
      libraryRefs("@Library([\n  'a@main', // first\n  'b'\n]) _\npipeline {}").map(
        (ref) => ref.content
      ),
      ["a@main", "b"]
    );
  });

  it("reads every library step form", () => {
    assert.deepEqual(
      libraryRefs("library 'a'").map((ref) => [ref.name, ref.source]),
      [["a", "step"]]
    );
    assert.deepEqual(
      libraryRefs("library('a@b')").map((ref) => [ref.name, ref.ref]),
      [["a", "b"]]
    );
    assert.deepEqual(
      libraryRefs(
        "library identifier: 'a@b', retriever: modernSCM([$class: 'GitSCMSource', remote: 'x'])"
      ).map((ref) => ref.content),
      ["a@b"]
    );
    assert.deepEqual(
      libraryRefs("library(changelog: false, identifier: 'c@d')").map((ref) => ref.content),
      ["c@d"]
    );
    assert.deepEqual(
      libraryRefs("def lib = library('x').com.acme\nnode { library \"y@${branch}\" }").map(
        (ref) => [ref.name, ref.ref]
      ),
      [
        ["x", undefined],
        ["y", "${branch}"]
      ]
    );
  });

  it("treats a newline as a statement boundary before a library step", () => {
    assert.deepEqual(
      libraryRefs("@Library('a') _\nlibrary 'b'").map((ref) => [ref.name, ref.source]),
      [
        ["a", "annotation"],
        ["b", "step"]
      ]
    );
    assert.deepEqual(
      libraryRefs("x = 1\nlibrary 'b'").map((ref) => ref.name),
      ["b"]
    );
    assert.deepEqual(
      libraryRefs("echo 'a'\nlibrary('b@main')").map((ref) => [ref.name, ref.ref]),
      [["b", "main"]]
    );
    assert.deepEqual(libraryRefs("x = 1\nfoo.library 'x'"), []);
    assert.deepEqual(libraryRefs("foo.\nlibrary 'x'"), []);
    assert.deepEqual(libraryRefs("foo\n  .library 'x'"), []);
    assert.deepEqual(libraryRefs("x = 1\ndef library = 'x'"), []);
  });

  it("reads lib(...) inside a declarative libraries directive", () => {
    const text = [
      "pipeline {",
      "  libraries {",
      "    lib('mylib@main')",
      '    lib("other")',
      "    lib 'bare@v1'",
      "  }",
      "  agent any",
      "}"
    ].join("\n");
    assert.deepEqual(
      libraryRefs(text).map((ref) => [ref.name, ref.ref, ref.source, ref.nameText]),
      [
        ["mylib", "main", "directive", "mylib"],
        ["other", undefined, "directive", "other"],
        ["bare", "v1", "directive", "bare"]
      ]
    );

    // An empty lib('') while typing still yields a ref for name completion.
    const typing = "pipeline {\n  libraries {\n    lib('')\n  }\n}";
    const [ref] = parseJenkinsfileModel(typing).libraryRefs;
    assert.equal(ref?.source, "directive");
    assert.equal(ref?.range.start, typing.indexOf("''") + 1);
  });

  it("ignores lib(...) outside a libraries block", () => {
    assert.deepEqual(libraryRefs("lib('a')"), []);
    assert.deepEqual(libraryRefs("pipeline {\n  stages { lib('a') }\n}"), []);
    assert.deepEqual(libraryRefs("pipeline {\n  libraries { foo.lib('a') }\n}"), []);
    assert.deepEqual(libraryRefs("pipeline {\n  libraries { x(lib('a')) }\n}"), []);
    assert.deepEqual(libraryRefs("pipeline {\n  libraries { script { lib('a') } }\n}"), []);
  });

  it("ignores member access, declarations and non-library strings", () => {
    assert.deepEqual(libraryRefs("foo.library('a')"), []);
    assert.deepEqual(libraryRefs("def library = 'a'"), []);
    assert.deepEqual(libraryRefs("String library(String name) { name }"), []);
    assert.deepEqual(libraryRefs("library = 'a'"), []);
    assert.deepEqual(libraryRefs("echo 'library(\"a\")'\n// @Library('b')"), []);
    assert.deepEqual(libraryRefs("library(retriever: x)"), []);
  });

  it("handles empty and unterminated strings", () => {
    const empty = "@Library('') _";
    const emptyModel = parseJenkinsfileModel(empty);
    const [emptyRef] = emptyModel.libraryRefs;
    assert.equal(emptyRef.name, "");
    assert.equal(emptyRef.range.start, emptyRef.range.end);
    assert.equal(emptyRef.range.start, empty.indexOf("''") + 1);
    assert.equal(findLibraryRefAt(emptyModel, emptyRef.range.start), emptyRef);

    const typing = "@Library('fo\r\npipeline { agent any }\n";
    const typingModel = parseJenkinsfileModel(typing);
    assert.deepEqual(
      typingModel.libraryRefs.map((ref) => slice(typingModel, ref.range)),
      ["fo"]
    );

    const typingList = "@Library(['a', 'b@ma\n";
    assert.deepEqual(
      libraryRefs(typingList).map((ref) => [ref.name, ref.ref, ref.content]),
      [
        ["a", undefined, "a"],
        ["b", "ma", "b@ma"]
      ]
    );

    const typingStep = "node {\n  library 'sha";
    assert.deepEqual(
      libraryRefs(typingStep).map((ref) => ref.content),
      ["sha"]
    );
  });

  it("finds the ref at an offset with an inclusive end", () => {
    const text = "@Library(['fo', 'bar@1']) _";
    const model = parseJenkinsfileModel(text);
    const fooEnd = text.indexOf("fo") + 2;
    assert.equal(findLibraryRefAt(model, fooEnd)?.name, "fo");
    assert.equal(findLibraryRefAt(model, text.indexOf("fo"))?.name, "fo");
    assert.equal(findLibraryRefAt(model, text.indexOf("@1") + 1)?.ref, "1");
    assert.equal(findLibraryRefAt(model, text.indexOf("[")), undefined);
  });
});

describe("parseJenkinsfileModel methods", () => {
  it("collects top-level methods with typed and defaulted parameters", () => {
    const text = [
      "def call(Map config = [:], Closure body) {",
      "  def nested(x) { x }",
      "  node { body() }",
      "}",
      "",
      "private static String format(final String value, int width = 10, def raw) {",
      "  return value",
      "}",
      "",
      "void notify(Map<String, List<String>> recipients, String... extra) {}",
      "java.util.List<String> names(x) { [] }",
      "def helper(body) { body() }",
      "private quick() {}",
      "def value = compute(1)",
      "if (ready) { echo 'x' }",
      "pipeline { stages {} }"
    ].join("\n");
    const model = parseJenkinsfileModel(text);

    assert.deepEqual(
      model.methods.map((method) => [method.name, method.parameterText, method.parameters]),
      [
        [
          "call",
          "Map config = [:], Closure body",
          [
            { name: "config", type: "Map", hasDefault: true },
            { name: "body", type: "Closure", hasDefault: false }
          ]
        ],
        [
          "format",
          "final String value, int width = 10, def raw",
          [
            { name: "value", type: "String", hasDefault: false },
            { name: "width", type: "int", hasDefault: true },
            { name: "raw", type: undefined, hasDefault: false }
          ]
        ],
        [
          "notify",
          "Map<String, List<String>> recipients, String... extra",
          [
            { name: "recipients", type: "Map<String, List<String>>", hasDefault: false },
            { name: "extra", type: "String...", hasDefault: false }
          ]
        ],
        ["names", "x", [{ name: "x", type: undefined, hasDefault: false }]],
        ["helper", "body", [{ name: "body", type: undefined, hasDefault: false }]],
        ["quick", "", []]
      ]
    );

    const [call, format] = model.methods;
    assert.equal(slice(model, call.nameRange), "call");
    assert.equal(call.range.start, 0);
    assert.equal(call.range.end, text.indexOf("}\n\nprivate") + 1);
    assert.equal(format.range.start, text.indexOf("private static"));
    assert.ok(slice(model, format.range).endsWith("return value\n}"));
  });

  it("runs an unclosed method to EOF", () => {
    const text = "def call(body) {\n  node {\n";
    const model = parseJenkinsfileModel(text);
    assert.equal(model.methods.length, 1);
    assert.equal(model.methods[0].range.end, text.length);
  });
});

describe("getJenkinsfileDocumentModel", () => {
  it("reuses the model for the same version and reparses on change", () => {
    let parses = 0;
    let content = "pipeline {}";
    const document = {
      version: 1,
      getText: () => {
        parses += 1;
        return content;
      }
    };

    const first = getJenkinsfileDocumentModel(document);
    const second = getJenkinsfileDocumentModel(document);
    assert.equal(first, second);
    assert.equal(parses, 1);

    content = "node {}";
    document.version = 2;
    const third = getJenkinsfileDocumentModel(document);
    assert.notEqual(third, first);
    assert.equal(third.blocks[0].label, "node");
    assert.equal(parses, 2);

    const other = getJenkinsfileDocumentModel({ version: 1, getText: () => "pipeline {}" });
    assert.notEqual(other, first);
  });

  it("keys documents without a version on their text", () => {
    let content = "pipeline {}";
    const document = { getText: () => content } as unknown as Parameters<
      typeof getJenkinsfileDocumentModel
    >[0];

    const first = getJenkinsfileDocumentModel(document);
    assert.equal(getJenkinsfileDocumentModel(document), first);

    content = "node {}";
    const changed = getJenkinsfileDocumentModel(document);
    assert.notEqual(changed, first);
    assert.equal(changed.blocks[0].label, "node");
  });
});
