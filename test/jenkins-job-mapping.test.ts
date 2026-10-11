import { describe, expect, it } from "vitest";
import type { JenkinsJob, JenkinsJobKind } from "../src/jenkins/JenkinsClient";
import { mapJenkinsJob, mapJenkinsJobs } from "../src/jenkins/data/JenkinsJobMapping";

const client = {
  classifyJob: (job: JenkinsJob): JenkinsJobKind => (job.name === "folder" ? "folder" : "pipeline")
};

describe("JenkinsJobMapping", () => {
  it("maps a single job to JenkinsJobInfo", () => {
    const job = { name: "app", url: "https://jenkins/job/app/", color: "blue" } as JenkinsJob;

    expect(mapJenkinsJob(client, job)).toEqual({
      name: "app",
      url: "https://jenkins/job/app/",
      color: "blue",
      kind: "pipeline"
    });
  });

  it("maps job lists with the single-job mapper", () => {
    const jobs = [
      { name: "app", url: "https://jenkins/job/app/", color: "red" },
      { name: "folder", url: "https://jenkins/job/folder/" }
    ] as JenkinsJob[];

    expect(mapJenkinsJobs(client, jobs)).toEqual(jobs.map((job) => mapJenkinsJob(client, job)));
  });
});
