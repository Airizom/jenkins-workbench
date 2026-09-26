import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const validatorPath = path.resolve("scripts/validate-release-workflow-actions.mjs");
const fixtureDirectories: string[] = [];
const checkoutSha = "df4cb1c069e1874edd31b4311f1884172cec0e10";
const uploadSha = "ea165f8d65b6e75b540449e92b4886f43607fa02";

const createFixture = async (
  steps: string,
  concurrency = `concurrency:\n  group: release-\${{ github.ref }}\n  cancel-in-progress: false\n`,
  additionalJobs = ""
) => {
  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), "jenkins-workbench-release-"));
  fixtureDirectories.push(fixtureDirectory);
  const workflowDirectory = path.join(fixtureDirectory, ".github", "workflows");
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "release.yml"),
    `name: Release\n${concurrency}jobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n${steps}\n${additionalJobs}`
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

const validUploadOptions = `          name: vsix
          path: ./*.vsix
          overwrite: true`;

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
      `${publishStep("node scripts/release.mjs publish extension.vsix")}\n${uploadStep(validUploadOptions)}`
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must upload the VSIX artifact before marketplace publication");
  });

  it("rejects a reusable workflow job pinned to a branch", async () => {
    const cwd = await createFixture(
      `${uploadStep(validUploadOptions)}\n${publishStep("node scripts/release.mjs publish extension.vsix")}`,
      undefined,
      "  reusable:\n    uses: owner/repo/.github/workflows/build.yml@main\n"
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "job reusable owner/repo/.github/workflows/build.yml@main must use a full 40-character commit SHA"
    );
  });

  it("accepts a reusable workflow job pinned to a full SHA", async () => {
    const cwd = await createFixture(
      `${uploadStep(validUploadOptions)}\n${publishStep("node scripts/release.mjs publish extension.vsix")}`,
      undefined,
      `  reusable:\n    uses: owner/repo/.github/workflows/build.yml@${checkoutSha}\n`
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(0);
  });

  it.each([
    [
      "an artifact upload without the vsix name",
      `          name: build-output
          path: ./*.vsix`
    ],
    [
      "an artifact upload of an unrelated path",
      `          name: vsix
          path: ./dist/**`
    ]
  ])("rejects %s", async (_name, withOptions) => {
    const cwd = await createFixture(
      `${uploadStep(withOptions)}\n${publishStep("node scripts/release.mjs publish extension.vsix")}`
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("artifact upload must use name: vsix and a .vsix path");
  });

  it.each([
    ["a no-op publication step", "echo done"],
    ["a publication step that only validates the tag", "node scripts/release.mjs validate-tag"],
    ["a publication step without a VSIX artifact", "node scripts/release.mjs publish"]
  ])("rejects %s", async (_name, run) => {
    const cwd = await createFixture(`${uploadStep(validUploadOptions)}\n${publishStep(run)}`);

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "publish-marketplaces step must run node scripts/release.mjs publish <artifact.vsix>"
    );
  });

  it.each([
    ["missing concurrency", ""],
    ["a group without the ref", "concurrency:\n  group: release\n  cancel-in-progress: false\n"],
    [
      "cancellation of an active release",
      `concurrency:\n  group: release-\${{ github.ref }}\n  cancel-in-progress: true\n`
    ]
  ])("rejects %s", async (_name, concurrency) => {
    const cwd = await createFixture(
      `${uploadStep(validUploadOptions)}\n${publishStep("node scripts/release.mjs publish extension.vsix")}`,
      concurrency
    );

    const result = runValidator(cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must define ref-scoped release concurrency");
  });
});
