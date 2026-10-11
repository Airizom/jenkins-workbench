import assert from "node:assert/strict";
import * as path from "node:path";
import { describe, it, vi } from "vitest";
import { BuildParameterRequestPreparerService } from "../src/services/BuildParameterRequestPreparerService";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => Buffer.from("file contents"))
}));

describe("BuildParameterRequestPreparerService multipart headers", () => {
  const preparer = new BuildParameterRequestPreparerService();

  for (const lineBreak of ["\r", "\n", "\r\n"]) {
    it.each(["field name", "file parameter name", "filename", "fallback filename"])(
      `rejects ${JSON.stringify(lineBreak)} in %s`,
      async (target) => {
        const unsafeValue = `upload${lineBreak}X-Injected: true`;

        await assert.rejects(
          preparer.prepareBuildParameters({
            fields: [{ name: target === "field name" ? unsafeValue : "text", value: "value" }],
            files: [
              {
                name: target === "file parameter name" ? unsafeValue : "upload",
                filePath: path.join(
                  "files",
                  target === "fallback filename" ? unsafeValue : "upload.txt"
                ),
                fileName:
                  target === "filename"
                    ? unsafeValue
                    : target === "fallback filename"
                      ? ""
                      : "upload.txt"
              }
            ]
          }),
          /Multipart header parameters must not contain CR or LF\./
        );
      }
    );
  }

  it("preserves quote and backslash escaping and allows line breaks in field values", async () => {
    const result = await preparer.prepareBuildParameters({
      fields: [{ name: 'text"\\name', value: "first\r\nsecond" }],
      files: [{ name: 'file"\\name', filePath: "upload.txt", fileName: 'upload"\\name.txt' }]
    });

    assert.equal(result.hasParameters, true);
    assert.ok(result.request);
    const boundary = result.request.headers["Content-Type"].split("boundary=")[1];
    assert.equal(
      result.request.body.toString(),
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="text\\"\\\\name"\r\n\r\n' +
        "first\r\nsecond\r\n" +
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file\\"\\\\name"; filename="upload\\"\\\\name.txt"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "file contents\r\n" +
        `--${boundary}--\r\n`
    );
  });
});
