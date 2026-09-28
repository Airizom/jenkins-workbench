import { expect, it } from "vitest";
import { formatAvailableTestReportCountsSummary } from "../src/panels/shared/TestReportFormatters";
it("derives Jenkins totals when only component counts are returned", () => {
  expect(formatAvailableTestReportCountsSummary({ passCount: 2, failCount: 0, skipCount: 0 })).toBe(
    "Failed 0 / 2 · Skipped 0"
  );
  expect(formatAvailableTestReportCountsSummary({ passCount: 2, failCount: 1, skipCount: 3 })).toBe(
    "Failed 1 / 6 · Skipped 3"
  );
  expect(
    formatAvailableTestReportCountsSummary({ totalCount: 10, passCount: 2, failCount: 1 })
  ).toBe("Failed 1 / 10");
  expect(formatAvailableTestReportCountsSummary({})).toBe("No test results.");
});

it("requests passing counts from Jenkins for reports without a totalCount field", async () => {
  const { JenkinsBuildsApi } = await import("../src/jenkins/client/JenkinsBuildsApi");
  const { createJenkinsClientContext } = await import("./helpers/jenkinsClientContext");
  const api = new JenkinsBuildsApi(
    createJenkinsClientContext({
      requestJson: async <T>(url: string): Promise<T> => {
        const fields = new URL(url).searchParams.get("tree")?.split(",") ?? [];
        const response: Record<string, number> = { failCount: 0, skipCount: 0 };
        if (fields.includes("passCount")) response.passCount = 2;
        return response as T;
      }
    })
  );
  const report = await api.getTestReport("https://jenkins.example/job/demo/1/");
  expect(formatAvailableTestReportCountsSummary(report)).toBe("Failed 0 / 2 · Skipped 0");
});
