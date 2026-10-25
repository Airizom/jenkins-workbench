import { randomUUID } from "node:crypto";
import * as path from "node:path";

export interface TemporaryFileWriteSteps<T> {
  write(temporaryPath: string): Promise<T>;
  rename(temporaryPath: string): PromiseLike<void>;
  delete(temporaryPath: string): PromiseLike<void>;
}

/**
 * Writes to a hidden temporary file next to `targetPath`, then renames it into place.
 * On failure the temporary file is deleted and the original error is rethrown.
 */
export async function writeViaTemporaryFile<T>(
  targetPath: string,
  steps: TemporaryFileWriteSteps<T>
): Promise<T> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`
  );
  try {
    const result = await steps.write(temporaryPath);
    await steps.rename(temporaryPath);
    return result;
  } catch (error) {
    try {
      await steps.delete(temporaryPath);
    } catch {
      // Preserve the original error if cleanup fails.
    }
    throw error;
  }
}
