import type * as vscode from "vscode";
import { trimToUndefined } from "../shared/stringValues";

export function getFiniteNumberConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  return Number.isFinite(value) ? value : defaultValue;
}

export function getBoundedIntegerConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number,
  minimumValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(minimumValue, Math.floor(value));
}

export function getClampedIntegerConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number,
  minimumValue: number,
  maximumValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(maximumValue, Math.max(minimumValue, Math.floor(value)));
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => trimToUndefined(item)).filter((item): item is string => Boolean(item));
}
