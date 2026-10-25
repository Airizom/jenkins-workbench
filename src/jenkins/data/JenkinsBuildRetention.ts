import { BuildActionError, JenkinsRequestError } from "../errors";
import type { JenkinsClient } from "../JenkinsClient";

const DELETE_REFUSED_MESSAGE =
  "Jenkins did not delete the build. It may be kept forever or protected by a dependency.";
const KEEP_RELEASE_REFUSED_MESSAGE =
  "Jenkins kept this build. It may be required by another build or retention rule.";
const KEEP_FOREVER_REFUSED_MESSAGE =
  "Jenkins did not mark this build to be kept forever. Check your permissions.";

/** Releases explicit retention only when requested, restoring it if deletion fails. */
export async function deleteBuildWithRetention(
  client: JenkinsClient,
  buildUrl: string,
  releaseKeep = false
): Promise<void> {
  const released = releaseKeep
    ? (await applyBuildKeepForever(client, buildUrl, false)).changed
    : false;
  try {
    await deleteBuildAndVerify(client, buildUrl);
  } catch (error) {
    if (released) {
      await restoreBuildKeepForever(client, buildUrl);
    }
    throw error;
  }
}

async function readBuildKeepLog(client: JenkinsClient, buildUrl: string): Promise<boolean> {
  const details = await client.getBuildDetails(buildUrl, { managementOnly: true });
  return Boolean(details.keepLog);
}

/**
 * Jenkins only exposes a keep-forever toggle, so the current state is read first and
 * the toggle is sent only when it differs. `changed` reports whether the toggle took.
 */
export async function applyBuildKeepForever(
  client: JenkinsClient,
  buildUrl: string,
  keep: boolean
): Promise<{ value: boolean; changed: boolean }> {
  const original = await readBuildKeepLog(client, buildUrl);
  if (original === keep) {
    return { value: keep, changed: false };
  }
  await client.toggleBuildKeepLog(buildUrl);
  const updated = await readBuildKeepLog(client, buildUrl);
  if (updated === original) {
    // Exported keepLog is `getWhyKeepLog() != null`, so a build kept only by a
    // dependency reports true while its own flag is false. The toggle then set
    // that flag; send it back so the build is not left explicitly kept.
    if (!keep) {
      await client.toggleBuildKeepLog(buildUrl);
    }
    throw new BuildActionError(
      keep ? KEEP_FOREVER_REFUSED_MESSAGE : KEEP_RELEASE_REFUSED_MESSAGE,
      "unknown"
    );
  }
  return { value: updated, changed: true };
}

async function restoreBuildKeepForever(client: JenkinsClient, buildUrl: string): Promise<void> {
  try {
    await applyBuildKeepForever(client, buildUrl, true);
  } catch {
    // The delete error is the one worth reporting; the caller's refresh shows the real state.
  }
}

async function deleteBuildAndVerify(client: JenkinsClient, buildUrl: string): Promise<void> {
  await client.deleteBuild(buildUrl);
  try {
    await client.getBuildDetails(buildUrl, { statusOnly: true });
  } catch (error) {
    if (error instanceof JenkinsRequestError && error.statusCode === 404) {
      return;
    }
    throw error;
  }
  throw new BuildActionError(DELETE_REFUSED_MESSAGE, "unknown");
}
