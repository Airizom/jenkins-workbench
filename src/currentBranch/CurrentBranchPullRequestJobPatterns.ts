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

const packageJson = require("../../package.json") as PackageManifest;

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
