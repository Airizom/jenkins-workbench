import type { JenkinsJob, JenkinsJobKind } from "../JenkinsClient";
import type { JenkinsJobInfo } from "./JenkinsDataTypes";

export function mapJenkinsJobs(
  client: { classifyJob(job: JenkinsJob): JenkinsJobKind },
  jobs: JenkinsJob[]
): JenkinsJobInfo[] {
  return jobs.map((job) => ({
    name: job.name,
    url: job.url,
    color: job.color,
    kind: client.classifyJob(job)
  }));
}
