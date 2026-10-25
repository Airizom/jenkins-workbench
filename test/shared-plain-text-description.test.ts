import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveCustomBuildDisplayName } from "../src/shared/build/BuildDisplayName";
import { toPlainTextDescription } from "../src/shared/html";

describe("toPlainTextDescription", () => {
  it("returns undefined for missing or blank values", () => {
    assert.equal(toPlainTextDescription(undefined), undefined);
    assert.equal(toPlainTextDescription(null), undefined);
    assert.equal(toPlainTextDescription(""), undefined);
    assert.equal(toPlainTextDescription("  \n\t "), undefined);
    assert.equal(toPlainTextDescription("<p>&nbsp;</p><br/>"), undefined);
  });

  it("strips tags, comments, scripts, and styles", () => {
    assert.equal(
      toPlainTextDescription(
        '<!-- hidden --><style>p{color:red}</style><script>alert("x")</script><a href="https://x">Re<b>lease</b></a>'
      ),
      "Release"
    );
  });

  it("decodes common and numeric entities once", () => {
    assert.equal(
      toPlainTextDescription(
        "a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; f&nbsp;g &#x2713; &#169;"
      ),
      "a & b <c> \"d\" 'e' f g ✓ ©"
    );
    assert.equal(toPlainTextDescription("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
    assert.equal(toPlainTextDescription("&unknown; &#0;"), "&unknown; &#0;");
  });

  it("does not turn escaped markup back into tags that are then stripped", () => {
    assert.equal(toPlainTextDescription("&lt;script&gt;x&lt;/script&gt;"), "<script>x</script>");
  });

  it("keeps plain comparisons that only look like tags", () => {
    assert.equal(toPlainTextDescription("a < b and c > d"), "a < b and c > d");
  });

  it("collapses whitespace while keeping line breaks from block elements", () => {
    assert.equal(
      toPlainTextDescription("<p>  First \t line </p>\n\n\n<div>Second<br>Third</div>"),
      "First line\nSecond\nThird"
    );
    assert.equal(toPlainTextDescription("one\r\n\r\ntwo   three"), "one\ntwo three");
  });

  it("truncates to the limit with an ellipsis", () => {
    const long = "word ".repeat(100);
    const result = toPlainTextDescription(long);
    assert.ok(result);
    assert.ok(Array.from(result).length <= 300);
    assert.ok(result.endsWith("…"));
    assert.equal(toPlainTextDescription("abcdef", 4), "abc…");
    assert.equal(toPlainTextDescription("abcd", 4), "abcd");
  });

  it("does not split surrogate pairs when truncating", () => {
    assert.equal(toPlainTextDescription("😀😀😀😀", 3), "😀😀…");
  });

  it("treats non-positive or non-finite limits as unlimited", () => {
    const long = "x".repeat(400);
    assert.equal(toPlainTextDescription(long, 0), long);
    assert.equal(toPlainTextDescription(long, Number.POSITIVE_INFINITY), long);
  });
});

describe("resolveCustomBuildDisplayName", () => {
  it("ignores missing, blank, and default display names", () => {
    assert.equal(resolveCustomBuildDisplayName({ number: 5 }), undefined);
    assert.equal(resolveCustomBuildDisplayName({ number: 5, displayName: " " }), undefined);
    assert.equal(resolveCustomBuildDisplayName({ number: 5, displayName: " #5 " }), undefined);
  });

  it("returns normalized custom names", () => {
    assert.equal(resolveCustomBuildDisplayName({ number: 5, displayName: "#6" }), "#6");
    assert.equal(
      resolveCustomBuildDisplayName({ number: 5, displayName: " release \n 1.2 " }),
      "release 1.2"
    );
  });
});
