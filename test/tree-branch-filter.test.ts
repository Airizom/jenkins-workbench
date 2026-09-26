import { expect, it } from "vitest";
import { JenkinsTreeFilter } from "../src/tree/TreeFilter";
import { decodeJenkinsJobName } from "../src/jenkins/JenkinsJobNames";
import type { JenkinsViewStateStore } from "../src/storage/JenkinsViewStateStore";
it("matches decoded multibranch names without altering their request URLs", () => {
  const filter = new JenkinsTreeFilter({
    getJobFilterMode: () => "all",
    getBranchFilter: () => "feature/"
  } as unknown as JenkinsViewStateStore);
  const jobs = [
    {
      name: "feature%2Fsmoke",
      url: "https://jenkins/job/repo/job/feature%252Fsmoke/",
      kind: "pipeline" as const
    }
  ];
  const result = filter.filterJobs(
    { environmentId: "local", scope: "workspace", url: "https://jenkins/" },
    jobs,
    { parentFolderKind: "multibranch", parentFolderUrl: "https://jenkins/job/repo/" }
  );
  expect(result).toEqual(jobs);
  expect(decodeJenkinsJobName(result[0].name)).toBe("feature/smoke");
  expect(decodeJenkinsJobName("branch%252Fname")).toBe("branch%2Fname");
  expect(decodeJenkinsJobName("branch%oops")).toBe("branch%oops");
});
