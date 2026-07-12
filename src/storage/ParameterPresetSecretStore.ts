import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";
import type { ParameterPresetValues } from "./ParameterPresetTypes";
import {
  cloneParameterValues,
  parseStoredParameterValue,
  sanitizeParameterValues
} from "./ParameterPresetValues";

const SECRET_KEY_PREFIX = "jenkinsWorkbench.parameterPresetSecret";

interface PresetSecretLocation {
  scope: EnvironmentScope;
  environmentId: string;
  jobUrl: string;
  presetId: string;
}

interface PreparePresetSecretsInput extends PresetSecretLocation {
  values: ParameterPresetValues;
  secretValues?: ParameterPresetValues;
  keepSecretNames?: readonly string[];
  previousSecretKeys?: Record<string, string>;
}

export interface PreparedPresetSecrets {
  values: ParameterPresetValues;
  secretKeys: Record<string, string>;
  newlyStoredKeys: string[];
}

export class ParameterPresetSecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async resolveValues(
    values: ParameterPresetValues,
    secretKeys?: Record<string, string>
  ): Promise<ParameterPresetValues> {
    const resolved = cloneParameterValues(values);
    for (const [name, key] of Object.entries(secretKeys ?? {})) {
      const stored = await this.secrets.get(key);
      if (typeof stored !== "string") {
        continue;
      }
      const parsed = parseStoredParameterValue(stored);
      if (parsed !== undefined) {
        resolved[name] = parsed;
      }
    }
    return resolved;
  }

  async prepare(input: PreparePresetSecretsInput): Promise<PreparedPresetSecrets> {
    const previousSecretKeys = input.previousSecretKeys ?? {};
    const preserveExistingSecrets = input.secretValues === undefined;
    const values = sanitizeParameterValues(input.values);
    const secretValues = sanitizeParameterValues(input.secretValues ?? {});

    movePreviousSecretValues(values, secretValues, previousSecretKeys, preserveExistingSecrets);
    removeSecretNamesFromValues(values, secretValues);

    const { secretKeys, newlyStoredKeys } = await this.storeSecretValues(input, secretValues);
    carryOverRetainedSecretKeys(secretKeys, previousSecretKeys, {
      preserveExistingSecrets,
      keepSecretNames: new Set(input.keepSecretNames ?? [])
    });

    return { values, secretKeys, newlyStoredKeys };
  }

  private async storeSecretValues(
    location: PresetSecretLocation,
    secretValues: ParameterPresetValues
  ): Promise<{ secretKeys: Record<string, string>; newlyStoredKeys: string[] }> {
    const secretKeys: Record<string, string> = {};
    const newlyStoredKeys: string[] = [];
    try {
      for (const [name, value] of Object.entries(secretValues)) {
        const secretKey = this.buildSecretKey(location, name);
        await this.secrets.store(secretKey, JSON.stringify(value));
        secretKeys[name] = secretKey;
        newlyStoredKeys.push(secretKey);
      }
    } catch (error) {
      await this.deleteKeyValuesBestEffort(newlyStoredKeys);
      throw error;
    }
    return { secretKeys, newlyStoredKeys };
  }

  async deleteUnused(
    previousSecretKeys: Record<string, string>,
    nextSecretKeys: Record<string, string>
  ): Promise<void> {
    for (const [name, key] of Object.entries(previousSecretKeys)) {
      if (nextSecretKeys[name] !== key) {
        await this.secrets.delete(key);
      }
    }
  }

  async deleteMappedKeys(secretKeys?: Record<string, string>): Promise<void> {
    for (const key of Object.values(secretKeys ?? {})) {
      await this.secrets.delete(key);
    }
  }

  async deleteKeyValuesBestEffort(secretKeys: readonly string[]): Promise<void> {
    for (const key of secretKeys) {
      try {
        await this.secrets.delete(key);
      } catch {
        // The operation that triggered this rollback remains the primary error.
      }
    }
  }

  private buildSecretKey(location: PresetSecretLocation, parameterName: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(
        `${location.scope}|${location.environmentId}|${location.jobUrl}|${location.presetId}|${parameterName}`
      )
      .digest("hex");
    return `${SECRET_KEY_PREFIX}.${location.scope}.${location.environmentId}.${hash}.${crypto.randomUUID()}`;
  }
}

// Parameters that were secret in the previous revision stay secret: when the
// caller did not provide replacement secret values, the plain value migrates
// into the secret set; either way it never persists in plain text.
function movePreviousSecretValues(
  values: ParameterPresetValues,
  secretValues: ParameterPresetValues,
  previousSecretKeys: Record<string, string>,
  preserveExistingSecrets: boolean
): void {
  for (const name of Object.keys(previousSecretKeys)) {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      continue;
    }
    if (preserveExistingSecrets) {
      secretValues[name] = values[name];
    }
    delete values[name];
  }
}

function removeSecretNamesFromValues(
  values: ParameterPresetValues,
  secretValues: ParameterPresetValues
): void {
  for (const name of Object.keys(secretValues)) {
    delete values[name];
  }
}

// Previous secret keys that were not replaced by a freshly stored value are
// kept only when the caller preserved existing secrets or explicitly listed
// the parameter name in keepSecretNames.
function carryOverRetainedSecretKeys(
  secretKeys: Record<string, string>,
  previousSecretKeys: Record<string, string>,
  options: { preserveExistingSecrets: boolean; keepSecretNames: ReadonlySet<string> }
): void {
  for (const [name, secretKey] of Object.entries(previousSecretKeys)) {
    if (secretKeys[name]) {
      continue;
    }
    if (options.preserveExistingSecrets || options.keepSecretNames.has(name)) {
      secretKeys[name] = secretKey;
    }
  }
}
