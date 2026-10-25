import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  stripConsoleControlSequences,
  toDisplayedConsoleText
} from "../src/buildDiagnostics/BuildDiagnosticConsoleText";

const note = "\u001b[8mha:////4M/hWhlhw5tN4KcfAOIF2I4xi0Q8XNOAlOjZ5p+AAAA==\u001b[0m";

describe("stripConsoleControlSequences", () => {
  it("keeps the text a Jenkins note annotates", () => {
    assert.equal(
      stripConsoleControlSequences(`Running on ${note}Jenkins in /var/jenkins_home`),
      "Running on Jenkins in /var/jenkins_home"
    );
  });

  it("removes ANSI colors and OSC hyperlinks around ordinary text", () => {
    assert.equal(
      stripConsoleControlSequences(
        "\u001b[31merror\u001b[0m \u001b]8;;https://example.test\u0007link\u001b]8;;\u0007"
      ),
      "error link"
    );
  });

  it("keeps carriage returns for per-line parsing", () => {
    assert.equal(stripConsoleControlSequences("line\r"), "line\r");
  });
});

describe("toDisplayedConsoleText", () => {
  it("matches the HTML console's line breaks", () => {
    assert.equal(toDisplayedConsoleText(`a\r\nb\rc\n${note}d`), "a\nb\nc\nd");
  });
});
