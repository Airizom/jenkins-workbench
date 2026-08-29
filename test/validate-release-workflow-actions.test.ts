import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const validatorPath = path.resolve("scripts/validate-release-workflow-actions.mjs");
const fixtureDirectories: string[] = [];
const checkoutSha = "df4cb1c069e1874edd31b4311f1884172cec0e10";
const uploadSha = "ea165f8d65b6e75b540449e92b4886f43607fa02";

const createFixture = async (steps: string) => {
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "jenkins-workbench-release-"));
  fixtureDirectories.push(fixtureDirectory);
  const workflowDirectory = path.join(fixtureDirectory, ".github", "workflows");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "release.yml"),
    `name: Release\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n`
  );
  return fixtureDirectory;
};

const uploadStep = (withOptions: string) => `      - name: Checkout
        uses: actions/checkout@${checkoutSha}
      - name: Upload artifact
        uses: actions/upload-artifact@${uploadSha}
        with:
${withOptions}`;

const publishStep = (run: string) => `      - name: Publish
        id: publish-marketplaces
        run: ${run}`;

const runValidator = (cwd: string) =>
  spawnSync(process.execPath, [validatorPath], { cwd, encoding: "utf8" });

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("release workflow validator", () => {
  it.each([
    [
      "canonical formatting",
      `          name: vsix
          path: ./*.vsix
          overwrite: true`,
      'node scripts/release.mjs publish "./extension.vsix"'
    ],
    [
      "reordered options and alternate shell quoting",
      `          overwrite: "true"
          path: "./*.vsix"
          name: "vsix"`,
      `'node "./scripts/release.mjs" "publish" ./extension.vsix'`
    ]
  ])("accepts %s", async (_name, withOptions, run) => {
    const cwd = await createFixture(`${uploadStep(withOptions)}\n${publishStep(run)}`);

    const result = runValidator(cwd);

    expect(result.status).toBe(0);
  });

  it("rejects marketplace publication before artifact upload", async () => {
    const cwd = await createFixture(
      `${publishStep("node scripts/release.mjs publish extension.vsix")}\n${uploadStep(
        "          overwrite: true"
      )}`
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must upload the VSIX artifact before marketplace publication");
  });
});
