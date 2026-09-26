import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactFilesystem } from "./ArtifactStorageService";

// File-backed filesystem adapter for artifact downloads (requires file scheme workspaces).
export function createFileArtifactFilesystem(): ArtifactFilesystem {
  return {
    createDirectory: (directoryPath, workspaceRoot) =>
      checkDirectory(directoryPath, workspaceRoot, true),
    createWriteStream: (filePath: string) => fs.createWriteStream(filePath, { flags: "wx" }),
    rename: async (sourcePath, targetPath, workspaceRoot) => {
      await checkDirectory(path.dirname(targetPath), workspaceRoot, false);
      try {
        if ((await fs.promises.lstat(targetPath)).isSymbolicLink()) {
          throw new Error("Artifact destination cannot be a symbolic link.");
        }
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
      await fs.promises.rename(sourcePath, targetPath);
    },
    delete: (targetPath: string) => fs.promises.unlink(targetPath)
  };
}

async function checkDirectory(
  directoryPath: string,
  workspaceRoot: string,
  createMissing: boolean
): Promise<void> {
  const relative = path.relative(workspaceRoot, directoryPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Artifact destination is outside the workspace.");
  }
  if (!(await fs.promises.stat(workspaceRoot)).isDirectory()) {
    throw new Error("Artifact workspace root is not a directory.");
  }

  let current = workspaceRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let entry: fs.Stats;
    try {
      entry = await fs.promises.lstat(current);
    } catch (error) {
      if (!createMissing || !isNotFound(error)) {
        throw error;
      }
      try {
        await fs.promises.mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") {
          throw mkdirError;
        }
      }
      entry = await fs.promises.lstat(current);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Artifact download directory contains a symbolic link or non-directory.");
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
