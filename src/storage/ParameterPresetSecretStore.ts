import * as crypto from "node:crypto";
import type * as vscode from "vscode";
import type { ParameterPresetValues } from "./ParameterPresetTypes";
import {
  cloneParameterValues,
  parseStoredParameterValue,
  sanitizeParameterValues
} from "./ParameterPresetValues";

const SECRET_KEY_PREFIX = "jenkinsWorkbench.parameterPresetSecret";

interface PreparePresetSecretsInput {
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
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Read one keychain entry at a time and stop on a storage failure.
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

    const { secretKeys, newlyStoredKeys } = await this.storeSecretValues(secretValues);
    carryOverRetainedSecretKeys(secretKeys, previousSecretKeys, {
      preserveExistingSecrets,
      keepSecretNames: new Set(input.keepSecretNames ?? [])
    });

    return { values, secretKeys, newlyStoredKeys };
  }

  private async storeSecretValues(
    secretValues: ParameterPresetValues
  ): Promise<{ secretKeys: Record<string, string>; newlyStoredKeys: string[] }> {
    const secretKeys: Record<string, string> = Object.create(null);
    const newlyStoredKeys: string[] = [];
    try {
      for (const [name, value] of Object.entries(secretValues)) {
        const secretKey = this.buildSecretKey();
        // eslint-disable-next-line react-doctor/async-await-in-loop -- Record each stored key before attempting the next write so rollback can remove it.
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

  /**
   * Stores each mapped secret value again under a fresh key, so a copied preset never shares
   * keys with its source (deleting either must not delete the other's secrets). Secrets missing
   * from storage are skipped. On failure the new keys are deleted and the error rethrown.
   */
  async copyMappedKeys(secretKeys: Record<string, string> | undefined): Promise<{
    secretKeys: Record<string, string>;
    newlyStoredKeys: string[];
  }> {
    const copied: Record<string, string> = Object.create(null);
    const newlyStoredKeys: string[] = [];
    try {
      for (const [name, key] of Object.entries(secretKeys ?? {})) {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- Finish copying each secret and recording its rollback key before reading the next.
        const value = await this.secrets.get(key);
        if (typeof value !== "string") {
          continue;
        }
        const secretKey = this.buildSecretKey();
        await this.secrets.store(secretKey, value);
        copied[name] = secretKey;
        newlyStoredKeys.push(secretKey);
      }
    } catch (error) {
      await this.deleteKeyValuesBestEffort(newlyStoredKeys);
      throw error;
    }
    return { secretKeys: copied, newlyStoredKeys };
  }

  async deleteUnused(
    previousSecretKeys: Record<string, string>,
    nextSecretKeys: Record<string, string>
  ): Promise<void> {
    for (const [name, key] of Object.entries(previousSecretKeys)) {
      if (nextSecretKeys[name] !== key) {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- Stop at the first failed deletion before touching any later keys.
        await this.secrets.delete(key);
      }
    }
  }

  async deleteMappedKeys(secretKeys?: Record<string, string>): Promise<void> {
    for (const key of Object.values(secretKeys ?? {})) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- Stop at the first failed deletion before touching any later keys.
      await this.secrets.delete(key);
    }
  }

  async deleteKeyValuesBestEffort(secretKeys: readonly string[]): Promise<void> {
    for (const key of secretKeys) {
      try {
        // eslint-disable-next-line react-doctor/async-await-in-loop -- Roll back one write at a time and continue independently after a failed deletion.
        await this.secrets.delete(key);
      } catch {
        // The operation that triggered this rollback remains the primary error.
      }
    }
  }

  private buildSecretKey(): string {
    return `${SECRET_KEY_PREFIX}.${crypto.randomUUID()}`;
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
    if (!Object.hasOwn(values, name)) {
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
    if (Object.hasOwn(secretKeys, name)) {
      continue;
    }
    if (options.preserveExistingSecrets || options.keepSecretNames.has(name)) {
      secretKeys[name] = secretKey;
    }
  }
}
