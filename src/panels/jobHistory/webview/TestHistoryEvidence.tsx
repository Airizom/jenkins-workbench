import * as React from "react";
import { buildTestCaseKey } from "../../shared/TestCaseViewModel";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import { HistoryContext } from "./HistoryContext";

export function TestHistoryEvidence({
  name,
  className,
  suiteName
}: {
  name: string;
  className?: string;
  suiteName?: string;
}) {
  const model = React.useContext(HistoryContext);
  const key = buildTestCaseKey(className, suiteName, name);
  const test = model.tests.find((item) => item.key === key);
  if (!test) return null;
  const evidence = model.evidence[key];
  const baseline = model.baselineOutcomes?.[key];
  return (
    <details className="px-3 py-2 text-xs">
      <summary>
        History: {evidence?.label ?? "Observed outcomes"}
        {test.intermittent ? " · Intermittent" : ""}
        {baseline === "failed" && evidence ? " · Also failing in baseline" : ""}
      </summary>
      <p>
        {evidence ? `Source: ${evidence.source}. ` : ""}
        {test.transitions} transitions · {test.passed + test.failed} usable observations. Newest
        first.
      </p>
      <ol>
        {model.builds.map(({ build }, index) => (
          <li key={build.number}>
            <button
              type="button"
              onClick={() =>
                postVsCodeMessage({
                  type: "historyAction",
                  revision: model.revision,
                  action: "openBuild",
                  value: build.number
                })
              }
            >
              #{build.number}
            </button>{" "}
            {test.outcomes[index]}
          </li>
        ))}
      </ol>
    </details>
  );
}
