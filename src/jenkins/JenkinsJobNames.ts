export function decodeJenkinsJobName(jobName: string): string {
  try {
    return decodeURIComponent(jobName);
  } catch {
    return jobName;
  }
}
