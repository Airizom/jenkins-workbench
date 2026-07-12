import * as fs from "node:fs";
import * as path from "node:path";

interface PackageConfigurationProperty {
  default?: unknown;
}

interface PackageManifest {
  contributes?: {
    configuration?: {
      properties?: Record<string, PackageConfigurationProperty>;
    };
  };
}

const packageJson = require(findPackageJsonPath(__dirname)) as PackageManifest;

const CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS_SETTING =
  "jenkinsWorkbench.currentBranch.pullRequestJobNamePatterns";

export const DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS =
  getContributedStringArrayDefault(CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS_SETTING);

function getContributedStringArrayDefault(settingId: string): readonly string[] {
  const defaultValue = packageJson.contributes?.configuration?.properties?.[settingId]?.default;
  if (!Array.isArray(defaultValue) || !defaultValue.every((value) => typeof value === "string")) {
    throw new Error(`Missing string-array default for ${settingId}.`);
  }

  return defaultValue;
}

function findPackageJsonPath(startDirectory: string): string {
  let directory = startDirectory;
  while (true) {
    const packageJsonPath = path.join(directory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) {
      throw new Error("Unable to locate package.json.");
    }
    directory = parentDirectory;
  }
}
