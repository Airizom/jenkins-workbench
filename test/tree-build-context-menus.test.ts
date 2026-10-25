import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "vitest";

const packageJson = JSON.parse(readFileSync(`${process.cwd()}/package.json`, "utf8")) as {
  contributes: { menus: Record<string, Array<{ command: string; when?: string }>> };
};

// BuildTreeItem appends optional tokens to its contextValue; a menu that targets builds must
// keep matching when they are present, or the action disappears for kept/paused builds.
it("build menu when-clauses tolerate the optional contextValue tokens", () => {
  const baseValues = ["build", "buildRunning"];
  const suffixes = [" awaitingInput", " keptForever", " awaitingInput keptForever"];
  let checked = 0;
  for (const entries of Object.values(packageJson.contributes.menus)) {
    for (const entry of entries) {
      const when = entry.when ?? "";
      assert.doesNotMatch(
        when,
        /viewItem\s*==\s*build(Running)?\b/,
        `${entry.command} matches build contextValue exactly`
      );
      for (const match of when.matchAll(/viewItem\s*=~\s*\/((?:\\\/|[^/])+)\//g)) {
        const pattern = new RegExp(match[1] ?? "");
        for (const base of baseValues) {
          if (!pattern.test(base)) {
            continue;
          }
          checked += 1;
          for (const suffix of suffixes) {
            assert.ok(pattern.test(`${base}${suffix}`), `${entry.command}: ${base}${suffix}`);
          }
        }
      }
    }
  }
  assert.ok(checked > 0);
});
