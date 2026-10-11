import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  type CodeMaskState,
  codeBeforeLineComment,
  maskNonCode,
  scanLineCode
} from "../src/validation/editor/JenkinsfilePipelineScanner";

describe("Jenkinsfile pipeline scanner", () => {
  const cases = [
    { name: "double-quoted comment markers", text: 'echo "// /* } agent */"' },
    { name: "single-quoted comment markers", text: "echo '// /* } agent */'" },
    { name: "escaped double quotes", text: String.raw`echo "\" // } agent"` },
    { name: "escaped single quotes", text: String.raw`echo '\' // } agent'` },
    { name: "block comments", text: "/* // } agent { */" },
    { name: "triple double quotes", text: 'echo """a " // } agent"""' },
    { name: "triple single quotes", text: "echo '''a ' // } agent'''" },
    { name: "dollar-slashy strings", text: `echo $/" // /* } agent \${value}/$` },
    { name: "escaped dollar-slashy delimiters", text: "echo $/$$ $/ $$$/ $/$$ $/$ agent/$" },
    { name: "escaped dollars before a closing delimiter", text: "echo $/value$$/$" },
    { name: "backslashes before a closing delimiter", text: String.raw`echo $/value\/$` },
    { name: "nested braces", text: "stages { stage { agent none } }" }
  ];

  for (const { name, text } of cases) {
    it(`preserves token, brace, and comment offsets through ${name}`, () => {
      const prefix = `pipeline { ${text} agent any } `;
      const line = `${prefix}// trailing agent }`;
      const start = line.indexOf("{") + 1;
      const tokenIndex = prefix.lastIndexOf("agent");
      const closeIndex = prefix.lastIndexOf("}");
      const code = maskNonCode(line, { inBlockComment: false });

      assert.equal(code.length, line.length);
      assert.equal(code.slice(tokenIndex, tokenIndex + 5), "agent");
      assert.equal(code[closeIndex], "}");
      assert.equal(code.slice(prefix.length).trim(), "");
      assert.equal(codeBeforeLineComment(line), prefix);
      assert.deepEqual(scanLineCode(line, start), { lineCommentIndex: prefix.length });
      assert.deepEqual(
        scanLineCode(
          line,
          start,
          line.length,
          (index, depth) => depth === 0 && line.startsWith("agent", index)
        ),
        { matchedIndex: tokenIndex }
      );
      assert.deepEqual(
        scanLineCode(
          line,
          start,
          line.length,
          (index, depth) => depth === 0 && line[index] === "}"
        ),
        { matchedIndex: closeIndex }
      );
    });
  }

  it("keeps the scan end exclusive and reports only comments within the range", () => {
    const line = "pipeline { agent any } // comment";
    const start = line.indexOf("{") + 1;
    const tokenIndex = line.indexOf("agent");
    const commentIndex = line.indexOf("//");
    const matches = (index: number) => line.startsWith("agent", index);

    assert.deepEqual(scanLineCode(line, start, tokenIndex, matches), {});
    assert.deepEqual(scanLineCode(line, start, tokenIndex + 1, matches), {
      matchedIndex: tokenIndex
    });
    assert.deepEqual(scanLineCode(line, start, commentIndex), {});
    assert.deepEqual(scanLineCode(line, start, commentIndex + 1), {
      lineCommentIndex: commentIndex
    });
    assert.deepEqual(scanLineCode(line, start, start, matches), {});
  });

  it("starts lexical state and brace depth at the requested offset", () => {
    const line = '"ignored { // agent any }';
    const start = line.indexOf("agent");

    assert.deepEqual(
      scanLineCode(line, start, line.length, (_index, depth) => depth === 0),
      {
        matchedIndex: start
      }
    );
  });

  it.each(['echo "// } agent', "/* // } agent"])("ignores unterminated non-code in %s", (line) => {
    assert.equal(codeBeforeLineComment(line), line);
    assert.deepEqual(
      scanLineCode(line, 0, line.length, (index) => line.startsWith("agent", index)),
      {}
    );
  });

  it("preserves block-comment and triple-quote state across lines", () => {
    const state: CodeMaskState = { inBlockComment: false };
    for (const line of ["/* open", "} */ '''open", "} // still quoted"]) {
      assert.equal(maskNonCode(line, state), " ".repeat(line.length));
    }
    const line = "closed''' agent any // comment";
    assert.equal(maskNonCode(line, state), "          agent any           ");
    assert.equal(state.inBlockComment, false);
    assert.equal(state.quote, undefined);
    assert.equal(maskNonCode("agent any", state), "agent any");
  });

  it("preserves dollar-slashy state across lines and escaped delimiters", () => {
    const state: CodeMaskState = { inBlockComment: false };
    for (const line of ["$/", "$/$$", "$$$/", "$/$", 'pipeline { " // /*', "}"]) {
      assert.equal(maskNonCode(line, state), " ".repeat(line.length));
    }
    assert.equal(maskNonCode("/$ agent any // comment", state), "   agent any           ");
    assert.equal(state.quote, undefined);
    assert.equal(maskNonCode("agent any", state), "agent any");
  });
});
