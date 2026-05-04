import type { JenkinsBuild } from "../jenkins/JenkinsClient";

export function resolveBuildElapsedMs(build: JenkinsBuild): number | undefined {
  if (Number.isFinite(build.timestamp)) {
    return Math.max(0, Date.now() - (build.timestamp as number));
  }
  if (Number.isFinite(build.duration)) {
    return Math.max(0, build.duration as number);
  }
  return undefined;
}
