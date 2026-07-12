import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  findPipelineBlock,
  hasInlineTopLevelSection,
  hasTopLevelSection
} from "../src/validation/editor/JenkinsfilePipelineParser";

function createDocument(text: string): Parameters<typeof findPipelineBlock>[0] {
  const lines = text.split(/\r?\n/);
  return {
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] })
  } as Parameters<typeof findPipelineBlock>[0];
}

function parsePipeline(text: string): {
  document: Parameters<typeof findPipelineBlock>[0];
  context: NonNullable<ReturnType<typeof findPipelineBlock>>;
} {
  const document = createDocument(text);
  const context = findPipelineBlock(document);
  assert.ok(context);
  return { document, context };
}

describe("Jenkinsfile pipeline parser", () => {
  it("ignores nested inline section tokens when checking top-level sections", () => {
    const { document, context } = parsePipeline(
      'pipeline { stages { stage("x") { steps { echo "agent" } } } }'
    );

    assert.equal(context.inline, true);
    assert.equal(hasTopLevelSection(document, context, "stages"), true);
    assert.equal(hasTopLevelSection(document, context, "agent"), false);
  });

  it("detects inline top-level sections outside comments and strings", () => {
    const commented = parsePipeline(
      'pipeline { stages { stage("x") { steps { echo "ok" } } } /* agent any */ }'
    );
    const topLevel = parsePipeline(
      'pipeline { stages { stage("x") { steps { echo "ok" } } } agent any }'
    );

    assert.equal(hasTopLevelSection(commented.document, commented.context, "agent"), false);
    assert.equal(hasTopLevelSection(topLevel.document, topLevel.context, "agent"), true);
  });

  describe("findPipelineBlock", () => {
    it("returns undefined when the document has no pipeline block", () => {
      assert.equal(findPipelineBlock(createDocument('node {\n  echo "hi"\n}')), undefined);
    });

    it("ignores pipeline keywords inside line comments", () => {
      assert.equal(findPipelineBlock(createDocument("// pipeline {\n// }")), undefined);

      const context = findPipelineBlock(createDocument("// pipeline {\npipeline {\n}"));
      assert.ok(context);
      assert.equal(context.openLine, 1);
      assert.equal(context.closeLine, 2);
    });

    it("skips pipeline lines that neither open a brace nor stand alone", () => {
      const context = findPipelineBlock(createDocument("pipeline agent\npipeline {\n}"));
      assert.ok(context);
      assert.equal(context.openLine, 1);

      assert.equal(findPipelineBlock(createDocument("pipeline agent any")), undefined);
    });

    it("parses a multi-line pipeline block with indentation metadata", () => {
      const context = findPipelineBlock(createDocument("pipeline {\n  agent any\n}"));
      assert.ok(context);
      assert.deepEqual(context, {
        openLine: 0,
        openChar: 9,
        closeLine: 2,
        closeChar: 0,
        pipelineIndent: "",
        childIndent: "  ",
        indentUnit: "  ",
        inline: false
      });
    });

    it("derives the indent unit from indented pipeline bodies", () => {
      const context = findPipelineBlock(
        createDocument("  pipeline {\n      stages {\n      }\n  }")
      );
      assert.ok(context);
      assert.equal(context.pipelineIndent, "  ");
      assert.equal(context.childIndent, "      ");
      assert.equal(context.indentUnit, "    ");
      assert.equal(context.closeLine, 3);
    });

    it("falls back to a two-space child indent when the body is empty or not indented", () => {
      const empty = findPipelineBlock(createDocument("pipeline {\n}"));
      assert.ok(empty);
      assert.equal(empty.childIndent, "  ");
      assert.equal(empty.indentUnit, "  ");

      const flat = findPipelineBlock(createDocument("pipeline {\nagent any\n}"));
      assert.ok(flat);
      assert.equal(flat.childIndent, "  ");
    });

    it("parses a bare pipeline keyword with the brace on the following line", () => {
      const context = findPipelineBlock(createDocument("pipeline\n{\n  agent any\n}"));
      assert.ok(context);
      assert.equal(context.openLine, 1);
      assert.equal(context.openChar, 0);
      assert.equal(context.closeLine, 3);
      assert.equal(context.inline, false);
    });

    it("allows blank lines between a bare pipeline keyword and its brace", () => {
      const context = findPipelineBlock(createDocument("pipeline\n\n{\n}"));
      assert.ok(context);
      assert.equal(context.openLine, 2);
      assert.equal(context.closeLine, 3);
    });

    it("returns undefined when a bare pipeline keyword is never followed by a brace", () => {
      assert.equal(findPipelineBlock(createDocument("pipeline\nagent any")), undefined);
      assert.equal(findPipelineBlock(createDocument("pipeline")), undefined);
    });

    it("returns undefined when the block is never closed at the pipeline indent", () => {
      assert.equal(findPipelineBlock(createDocument("pipeline {\n  agent any\n")), undefined);
      assert.equal(findPipelineBlock(createDocument("pipeline {\n  agent any\n  }")), undefined);
    });

    it("resolves the inline closing brace across nested blocks", () => {
      const text = "pipeline { stages { } }";
      const context = findPipelineBlock(createDocument(text));
      assert.ok(context);
      assert.equal(context.inline, true);
      assert.equal(context.openChar, 9);
      assert.equal(context.closeChar, text.length - 1);
      assert.equal(context.childIndent, "  ");
    });

    it("ignores braces behind a trailing line comment when closing the block", () => {
      const context = findPipelineBlock(createDocument("pipeline { // start }\n}"));
      assert.ok(context);
      assert.equal(context.inline, false);
      assert.equal(context.closeLine, 1);
      assert.equal(context.closeChar, 0);
    });
  });

  describe("hasTopLevelSection", () => {
    it("finds sections in multi-line pipeline blocks", () => {
      const { document, context } = parsePipeline(
        'pipeline {\n  agent any\n  stages {\n    stage("x") {\n    }\n  }\n}'
      );
      assert.equal(context.inline, false);
      assert.equal(hasTopLevelSection(document, context, "agent"), true);
      assert.equal(hasTopLevelSection(document, context, "stages"), true);
      assert.equal(hasTopLevelSection(document, context, "options"), false);
    });

    it("ignores inline tokens inside double- and single-quoted strings", () => {
      const doubleQuoted = parsePipeline('pipeline { echo "\\"agent\\"" }');
      const singleQuoted = parsePipeline("pipeline { echo 'agent' }");

      assert.equal(hasTopLevelSection(doubleQuoted.document, doubleQuoted.context, "agent"), false);
      assert.equal(hasTopLevelSection(singleQuoted.document, singleQuoted.context, "agent"), false);
    });

    it("resumes scanning after block comments even when they contain braces", () => {
      const { document, context } = parsePipeline("pipeline { /* { */ } agent any }");
      assert.equal(context.inline, true);
      assert.equal(hasTopLevelSection(document, context, "agent"), true);
    });

    it("does not match tokens that are part of a longer identifier", () => {
      const { document, context } = parsePipeline("pipeline { agents any }");
      assert.equal(hasTopLevelSection(document, context, "agent"), false);
    });
  });

  describe("hasInlineTopLevelSection", () => {
    it("stops scanning at a line comment", () => {
      assert.equal(hasInlineTopLevelSection("{ // agent }", 1, 12, "agent"), false);
    });

    it("ignores tokens truncated by the scan end", () => {
      assert.equal(hasInlineTopLevelSection("{ agent }", 1, 6, "agent"), false);
      assert.equal(hasInlineTopLevelSection("{ agent }", 1, 8, "agent"), true);
    });

    it("treats an unterminated block comment as hiding the rest of the line", () => {
      assert.equal(hasInlineTopLevelSection("{ /* agent }", 1, 12, "agent"), false);
    });

    it("skips escaped characters inside strings", () => {
      assert.equal(hasInlineTopLevelSection('{ "\\" agent" }', 1, 13, "agent"), false);
    });

    it("only matches tokens at brace depth zero", () => {
      assert.equal(hasInlineTopLevelSection("{ inner { agent } }", 1, 18, "agent"), false);
      assert.equal(hasInlineTopLevelSection("{ } agent {", 1, 11, "agent"), true);
    });
  });
});
