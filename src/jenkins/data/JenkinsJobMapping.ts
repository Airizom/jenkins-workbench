import type { JenkinsJob, JenkinsJobKind } from "../JenkinsClient";
import type { JenkinsJobInfo } from "./JenkinsDataTypes";

type JenkinsJobClassifier = { classifyJob(job: JenkinsJob): JenkinsJobKind };

export function mapJenkinsJob(client: JenkinsJobClassifier, job: JenkinsJob): JenkinsJobInfo {
  return {
    name: job.name,
    url: job.url,
    color: job.color,
    kind: client.classifyJob(job)
  };
}

export function mapJenkinsJobs(client: JenkinsJobClassifier, jobs: JenkinsJob[]): JenkinsJobInfo[] {
  return jobs.map((job) => mapJenkinsJob(client, job));
}
