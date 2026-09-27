import { expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { HistoryDependencies } from "../src/panels/jobHistory/HistoryController";
import { chooseHistoryBaseline } from "../src/panels/jobHistory/HistoryBaselinePicker";

it("does not enumerate jobs after baseline metadata resolves for an inactive panel", async () => {
  let resolve!: (value: { url: string; multibranch: boolean }) => void;
  let active = true;
  const getAllJobsForEnvironment = vi.fn();
  const dependencies = {
    baseline: {
      project: () =>
        new Promise((done) => {
          resolve = done;
        })
    },
    data: { getAllJobsForEnvironment }
  } as unknown as HistoryDependencies;
  const pending = chooseHistoryBaseline(
    {} as vscode.WebviewPanel,
    dependencies,
    {
      environment: { environmentId: "e", scope: "workspace", url: "https://jenkins.test/" },
      jobUrl: "https://jenkins.test/job/a/",
      count: 20,
      active: () => active
    },
    false
  );
  active = false;
  resolve({ url: "https://jenkins.test/job/a/", multibranch: false });
  expect(await pending).toBe(false);
  expect(getAllJobsForEnvironment).not.toHaveBeenCalled();
});
