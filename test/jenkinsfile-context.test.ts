import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { analyzeJenkinsfileContext } from "../src/jenkinsfile/JenkinsfileContextAnalyzer";
import {
  analyzeActiveCallArguments,
  findBareActiveCall
} from "../src/jenkinsfile/context/JenkinsfileCallAnalysis";
import {
  findPartialIdentifier,
  isValidStepStart
} from "../src/jenkinsfile/context/JenkinsfileContextNavigation";
import {
  computeHasNodeContext,
  computeIsStepAllowed
} from "../src/jenkinsfile/context/JenkinsfileContextRules";
import { maskGroovyText } from "../src/jenkinsfile/context/JenkinsfileGroovyTextMasker";

const CURSOR = "/*cursor*/";

function withCursor(source: string): { text: string; offset: number } {
  const offset = source.indexOf(CURSOR);
  assert.notEqual(offset, -1);
  return {
    text: source.replace(CURSOR, ""),
    offset
  };
}

function analyzeMarkedText(source: string): ReturnType<typeof analyzeJenkinsfileContext> {
  const { text, offset } = withCursor(source);
  const document = {
    getText: () => text,
    offsetAt: (position: { offset: number }) => position.offset
  };

  return analyzeJenkinsfileContext(
    document as unknown as Parameters<typeof analyzeJenkinsfileContext>[0],
    { offset } as unknown as Parameters<typeof analyzeJenkinsfileContext>[1]
  );
}

describe("Jenkinsfile Groovy context parsing", () => {
  it("masks comments and strings while preserving interpolation expressions", () => {
    const text = [
      "echo \"deploy ${params.TARGET ?: 'prod'}\" // hiddenCall()",
      "sh 'rm -rf /'",
      "/* retry(3) */ timeout(time: 5)"
    ].join("\n");

    const masked = maskGroovyText(text);

    assert.equal(masked.length, text.length);
    assert.equal(masked.split("\n").length, text.split("\n").length);
    assert.ok(masked.includes("${params.TARGET ?:"));
    assert.ok(masked.includes("timeout(time: 5)"));
    assert.equal(masked.includes("hiddenCall"), false);
    assert.equal(masked.includes("rm -rf"), false);
    assert.equal(masked.includes("prod"), false);
  });

  it("preserves length for unterminated strings ending with an escape", () => {
    for (const text of ["'\\", '"\\']) {
      assert.equal(maskGroovyText(text).length, text.length);
    }
  });

  it("keeps escaped triple-quote delimiters and following punctuation masked", () => {
    for (const delimiter of ["'''", '"""']) {
      const literal = `${delimiter}before \\${delimiter} , } hidden${delimiter}`;
      assert.equal(maskGroovyText(`${literal}, visible`), `${" ".repeat(literal.length)}, visible`);
    }
  });

  it("ignores slashy string punctuation when finding the active argument", () => {
    for (const source of [
      "sh(/a,b}\\/c/, timeout: /*cursor*/2)",
      "sh /a,b/, timeout: /*cursor*/2",
      "sh /a,b/.trim(), timeout: /*cursor*/2",
      "sh /a,b/ as String, timeout: /*cursor*/2",
      "sh(foo + /a,b/, timeout: /*cursor*/2)",
      "sh /a,\nb/, timeout: /*cursor*/2",
      "sh($/a,b}/*c*/$/, timeout: /*cursor*/2)",
      "sh($/a$$b$/c,} /$, timeout: /*cursor*/2)"
    ]) {
      const context = analyzeMarkedText(source);
      assert.equal(context.argumentContext?.activeIndex, 1);
      assert.equal(context.argumentContext?.activeName, "timeout");
      assert.equal(context.argumentContext?.usesNamedArgs, true);
    }
  });

  it("keeps slashy string braces out of the block path and preserves interpolation", () => {
    const interpolation = `\${params.VALUE ?: 'x'}`;
    for (const literal of [`/} ${interpolation} ,/`, `$/} ${interpolation} ,/$`]) {
      const context = analyzeMarkedText(`pipeline { steps { sh(${literal}); sh(/*cursor*/) } }`);
      assert.deepEqual(context.blockPath, ["pipeline", "steps"]);
      assert.equal(context.activeCall?.name, "sh");
      assert.equal(context.argumentContext?.activeIndex, 0);
      assert.ok(context.maskedText.includes("${params.VALUE ?:"));
    }
  });

  it("does not treat division as a slashy string", () => {
    assert.equal(maskGroovyText("value / amount, next"), "value / amount, next");
  });

  it("reports named argument context for parenthesized calls with Elvis and ternary arguments", () => {
    const { text, offset } = withCursor(
      'sh(script: params.CMD ?: "make test", returnStatus: /*cursor*/)'
    );
    const maskedText = maskGroovyText(text);
    const openParen = text.indexOf("(");

    assert.deepEqual(
      analyzeActiveCallArguments(
        maskedText,
        { name: "sh", syntax: "paren", callStart: text.indexOf("sh"), openParen },
        offset
      ),
      {
        activeIndex: 1,
        activeName: "returnStatus",
        usesNamedArgs: true
      }
    );

    const ternary = withCursor("input(condition ? first: second, message: /*cursor*/)");
    assert.deepEqual(
      analyzeActiveCallArguments(
        maskGroovyText(ternary.text),
        {
          name: "input",
          syntax: "paren",
          callStart: ternary.text.indexOf("input"),
          openParen: ternary.text.indexOf("(")
        },
        ternary.offset
      ),
      {
        activeIndex: 1,
        activeName: "message",
        usesNamedArgs: true
      }
    );
  });

  it("detects bare active calls after control and return prefixes", () => {
    const { text, offset } = withCursor(
      'return sh label: "build", script: command ?: "make", returnStatus: /*cursor*/'
    );
    const maskedText = maskGroovyText(text);
    const activeCall = findBareActiveCall(maskedText, offset);

    assert.deepEqual(activeCall, {
      name: "sh",
      syntax: "bare",
      callStart: text.indexOf("sh")
    });
    assert.deepEqual(analyzeActiveCallArguments(maskedText, activeCall, offset), {
      activeIndex: 2,
      activeName: "returnStatus",
      usesNamedArgs: true
    });

    const guarded = withCursor("if (ready) sh script: /*cursor*/");
    assert.deepEqual(findBareActiveCall(maskGroovyText(guarded.text), guarded.offset), {
      name: "sh",
      syntax: "bare",
      callStart: guarded.text.indexOf("sh")
    });
  });

  it("tracks declarative block paths and step-allowed rules", () => {
    const stepsAnalysis = analyzeMarkedText(`
pipeline {
  stages {
    stage('Build') {
      steps {
        sh script: ${CURSOR}
      }
    }
  }
}`);

    assert.deepEqual(stepsAnalysis.blockPath, ["pipeline", "stages", "stage", "steps"]);
    assert.equal(stepsAnalysis.isStepAllowed, true);
    assert.equal(stepsAnalysis.hasNodeContext, true);
    assert.equal(stepsAnalysis.activeCall?.name, "sh");
    assert.equal(stepsAnalysis.argumentContext?.activeName, "script");

    const environmentAnalysis = analyzeMarkedText(`
pipeline {
  environment {
    FOO = ${CURSOR}
  }
}`);

    assert.deepEqual(environmentAnalysis.blockPath, ["pipeline", "environment"]);
    assert.equal(environmentAnalysis.isStepAllowed, false);
    assert.equal(environmentAnalysis.hasNodeContext, false);
    assert.equal(computeIsStepAllowed(["pipeline"]), false);
    for (const label of ["node", "steps", "script"]) {
      assert.equal(computeIsStepAllowed(["pipeline", label]), true);
      assert.equal(computeHasNodeContext(["pipeline", label]), true);
    }
    assert.equal(computeIsStepAllowed(["pipeline", "post"]), false);
    assert.equal(computeIsStepAllowed(["pipeline", "post", "always"]), true);
    assert.equal(computeIsStepAllowed(["pipeline", "post", "unknown"]), false);
    assert.equal(computeHasNodeContext(["pipeline", "post"]), true);
    assert.equal(computeIsStepAllowed(["pipeline", "environment"]), false);
    assert.equal(computeHasNodeContext(["pipeline", "environment"]), false);
  });

  it("validates step-start navigation around member access and keyword prefixes", () => {
    const text = "foo.bar\nreturn sh\nst";
    const maskedText = maskGroovyText(text);
    const memberStart = text.indexOf("bar");
    const returnStepStart = text.indexOf("sh");
    const partialOffset = text.length;

    assert.equal(isValidStepStart(maskedText, memberStart), false);
    assert.equal(isValidStepStart(maskedText, returnStepStart), true);
    assert.deepEqual(findPartialIdentifier(maskedText, partialOffset), {
      name: "st",
      start: text.indexOf("st"),
      end: partialOffset
    });
  });
});
