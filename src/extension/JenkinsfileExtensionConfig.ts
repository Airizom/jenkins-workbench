import type * as vscode from "vscode";
import type { JenkinsfileIntelligenceConfig } from "../jenkinsfile/JenkinsfileIntelligenceTypes";
import type { JenkinsSharedLibraryConfigEntry } from "../jenkinsfile/sharedLibraries/JenkinsSharedLibraryTypes";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";
import * as definitions from "./ExtensionConfigDefinitions";
import { getBoundedIntegerConfigValue, normalizeStringList } from "./ExtensionConfigValueReaders";

function getJenkinsfileValidationEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      definitions.CONFIG_KEYS.jenkinsfileValidationEnabled,
      definitions.DEFAULT_JENKINSFILE_VALIDATION_ENABLED
    )
  );
}

function getJenkinsfileIntelligenceEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      definitions.CONFIG_KEYS.jenkinsfileIntelligenceEnabled,
      definitions.DEFAULT_JENKINSFILE_INTELLIGENCE_ENABLED
    )
  );
}

function getJenkinsfileValidationRunOnSave(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      definitions.CONFIG_KEYS.jenkinsfileValidationRunOnSave,
      definitions.DEFAULT_JENKINSFILE_VALIDATION_RUN_ON_SAVE
    )
  );
}

function getJenkinsfileValidationChangeDebounceMs(config: vscode.WorkspaceConfiguration): number {
  return getBoundedIntegerConfigValue(
    config,
    definitions.CONFIG_KEYS.jenkinsfileValidationChangeDebounce,
    definitions.DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS,
    0
  );
}

function getJenkinsfileValidationFilePatterns(config: vscode.WorkspaceConfiguration): string[] {
  const value = config.get<unknown>(
    definitions.CONFIG_KEYS.jenkinsfileValidationFilePatterns,
    definitions.DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS
  );
  const patterns = normalizeStringList(value);
  return patterns.length > 0 ? patterns : definitions.DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS;
}

export function getJenkinsfileValidationConfig(
  config: vscode.WorkspaceConfiguration
): JenkinsfileValidationConfig {
  return {
    enabled: getJenkinsfileValidationEnabled(config),
    runOnSave: getJenkinsfileValidationRunOnSave(config),
    changeDebounceMs: getJenkinsfileValidationChangeDebounceMs(config),
    filePatterns: getJenkinsfileValidationFilePatterns(config)
  };
}

export function getJenkinsfileIntelligenceConfig(
  config: vscode.WorkspaceConfiguration
): JenkinsfileIntelligenceConfig {
  return {
    enabled: getJenkinsfileIntelligenceEnabled(config)
  };
}

/**
 * Reads `jenkinsfile.sharedLibraries`: trims names and paths and drops entries without both.
 * This is the only place the setting is validated; the library index trusts these entries.
 */
export function getJenkinsfileSharedLibraryEntries(
  config: vscode.WorkspaceConfiguration
): JenkinsSharedLibraryConfigEntry[] {
  const value = config.get<unknown>(definitions.CONFIG_KEYS.jenkinsfileSharedLibraries, []);
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: JenkinsSharedLibraryConfigEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!name || !path) {
      continue;
    }
    entries.push(record.implicit === true ? { name, path, implicit: true } : { name, path });
  }
  return entries;
}
