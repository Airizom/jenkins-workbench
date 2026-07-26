import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface TypeScriptConfig {
  include?: string[];
  exclude?: string[];
}

describe("extension TypeScript configuration", () => {
  it("limits source discovery to the extension source tree", () => {
    const config = JSON.parse(
      readFileSync(path.resolve("tsconfig.json"), "utf8")
    ) as TypeScriptConfig;

    expect(config.include).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(config.exclude?.every((pattern) => pattern.startsWith("src/"))).toBe(true);
  });
});
