import * as React from "react";
import { historyMetrics } from "../../../history/HistoryAnalysis";
import { isPlainRecord } from "../../../shared/runtimeGuards";
import {
  getVsCodeState,
  postVsCodeMessage,
  setVsCodeState
} from "../../shared/webview/lib/vscodeApi";
import { type HistoryAction, normalizeHistoryUi } from "../shared/HistoryContracts";
import { HistoryContext } from "./HistoryContext";

const duration = (value: number | undefined) =>
  value === undefined ? "Unavailable" : `${(value / 1000).toFixed(1)}s`;
export function HistoryView({ embedded = false }: { embedded?: boolean }) {
  const model = React.useContext(HistoryContext);
  const [ui, setUi] = React.useState(() =>
    normalizeHistoryUi(getVsCodeState<{ historyUi?: unknown }>()?.historyUi)
  );
  const [page, setPage] = React.useState(0);
  const send = (action: HistoryAction["action"], value?: number) =>
    postVsCodeMessage({
      type: "historyAction",
      revision: model.revision,
      action,
      value
    } satisfies HistoryAction);
  React.useEffect(() => {
    const saved = getVsCodeState();
    setVsCodeState({ ...(isPlainRecord(saved) ? saved : {}), historyUi: ui });
    postVsCodeMessage({ type: "persistHistoryUi", uiState: ui });
  }, [ui]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These changes reset pagination even though their values are not read by the effect.
  React.useEffect(() => {
    setPage(0);
  }, [ui.search, ui.filter, model.jobUrl]);
  const selectedIndex = model.builds.findIndex((item) => item.build.number === model.selectedBuild);
  const baselineCases = new Map(Object.entries(model.baselineOutcomes ?? {}));
  const metrics = historyMetrics(model.builds.map((item) => item.build));
  const tests = model.tests.filter((test) => {
    if (
      !`${test.name} ${test.className ?? ""} ${test.suiteName ?? ""}`
        .toLowerCase()
        .includes(ui.search.toLowerCase())
    )
      return false;
    const kind = model.evidence[test.key]?.kind;
    switch (ui.filter) {
      case "intermittent":
        return test.intermittent;
      case "failed":
        return test.outcomes[selectedIndex] === "failed";
      case "new":
        return kind === "new";
      case "continuing":
        return kind === "continuing";
      case "baseline":
        return (
          test.outcomes[selectedIndex] === "failed" && baselineCases.get(test.key) === "failed"
        );
      default:
        return true;
    }
  });
  const maxDuration = Math.max(1, ...model.builds.map((item) => item.build.duration ?? 0));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(tests.length / 50) - 1));
  const selectedTest = model.tests.find((test) => test.key === ui.selectedTest);
  const fresh = Object.values(model.evidence).filter((value) => value.kind === "new").length;
  const continuing = Object.values(model.evidence).filter(
    (value) => value.kind === "continuing"
  ).length;
  const failedIntermittent = model.tests.filter(
    (test) => test.intermittent && test.outcomes[selectedIndex] === "failed"
  ).length;
  const alsoFailing = model.tests.filter(
    (test) => test.outcomes[selectedIndex] === "failed" && baselineCases.get(test.key) === "failed"
  ).length;
  const content = (
    <>
      <div className="history-toolbar">
        <label>
          Build window{" "}
          <select
            aria-label="History build window"
            value={model.count}
            onChange={(event) => {
              const count = Number(event.target.value) as 10 | 20 | 50;
              setUi({ ...ui, count });
              send("window", count);
            }}
          >
            {[10, 20, 50].map((count) => (
              <option key={count}>{count}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => send("refresh")}>
          Refresh history
        </button>
        <button type="button" onClick={() => send("baseline")}>
          Select baseline
        </button>
        <button type="button" onClick={() => send("resetBaseline")}>
          Reset baseline
        </button>
        {embedded && (
          <button type="button" onClick={() => send("openJob")}>
            Open Job History
          </button>
        )}
      </div>
      <p role="status">
        {model.status === "loading" ? "Loading history… " : ""}
        {model.builds.length} sampled builds.{" "}
        {model.builds.filter((item) => item.report.status !== "available").length} unavailable
        reports.{model.truncated ? " Lookup capped at 500 build summaries." : ""}
      </p>
      {model.testsTruncated && (
        <p role="status">
          Test sample capped at 50,000 observations and 5,000 distinct tests. Failing cases are
          retained first; omitted cases are unavailable, not passing.
        </p>
      )}
      {model.message && <p role="alert">{model.message}</p>}
      {model.selectedBuild && (
        <p>
          Build #{model.selectedBuild}: {fresh} new · {continuing} continuing · {failedIntermittent}{" "}
          intermittent · {alsoFailing} also failing in baseline. Counts may overlap.
        </p>
      )}
      <p>
        Baseline: {model.baseline?.label ?? model.baseline?.message ?? "Not loaded"}
        {model.baseline?.build && (
          <>
            {" "}
            #{model.baseline.build.number} ·{" "}
            {new Date(model.baseline.build.timestamp ?? 0).toLocaleString()} · completed before the
            selected build started.{" "}
            <button type="button" onClick={() => send("compare", model.selectedBuild)}>
              Compare baseline
            </button>
          </>
        )}
        {model.baseline?.truncated && " Latest eligible build in the first 500 summaries."}
        {model.baseline?.label && model.baseline.message && ` · ${model.baseline.message}`}
      </p>
      {!embedded && (
        <>
          <p>
            Success rate:{" "}
            {metrics.denominator
              ? `${Math.round((100 * metrics.successful) / metrics.denominator)}%`
              : "Unavailable"}{" "}
            · {metrics.successful}/{metrics.denominator} SUCCESS, UNSTABLE or FAILURE builds.
            Aborted: {metrics.aborted}; not built: {metrics.notBuilt}; unknown: {metrics.unknown}.
          </p>
          <p>Median duration: {duration(metrics.medianDuration)}</p>
          <ol className="history-builds" aria-label="Chronological build results and durations">
            {[...model.builds].reverse().map(({ build, report }) => (
              <li key={build.number}>
                <button
                  type="button"
                  aria-pressed={model.selectedBuild === build.number}
                  onClick={() => {
                    setUi({ ...ui, selectedBuild: build.number });
                    send("selectBuild", build.number);
                  }}
                >
                  #{build.number} {build.result}
                </button>
                {["SUCCESS", "UNSTABLE", "FAILURE"].includes(build.result ?? "") && (
                  <>
                    <meter
                      aria-label={`Build ${build.number} duration`}
                      min={0}
                      max={maxDuration}
                      value={build.duration ?? 0}
                    />{" "}
                    {duration(build.duration)}
                  </>
                )}
                <span> Test report: {report.status}</span>
                <button type="button" onClick={() => send("openBuild", build.number)}>
                  Open build
                </button>
                <button type="button" onClick={() => send("compare", build.number)}>
                  Compare with selected
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="history-toolbar">
        <input
          aria-label="Search test history"
          placeholder="Search tests"
          value={ui.search}
          onChange={(event) => setUi({ ...ui, search: event.target.value })}
        />
        <select
          aria-label="Filter test history"
          value={ui.filter}
          onChange={(event) => setUi(normalizeHistoryUi({ ...ui, filter: event.target.value }))}
        >
          <option value="all">All tests</option>
          <option value="intermittent">Intermittent</option>
          <option value="failed">Failing in selected build</option>
          <option value="new">New failures</option>
          <option value="continuing">Continuing failures</option>
          <option value="baseline">Also failing in baseline</option>
        </select>
      </div>
      <table className="history-table">
        <thead>
          <tr>
            <th>Test</th>
            <th>Failure rate</th>
            <th>Transitions</th>
            <th>Evidence for selected build</th>
          </tr>
        </thead>
        <tbody>
          {tests.slice(currentPage * 50, currentPage * 50 + 50).map((test) => (
            <tr key={test.key}>
              <td>
                <button type="button" onClick={() => setUi({ ...ui, selectedTest: test.key })}>
                  {test.name}
                </button>
                <small>{[test.suiteName, test.className].filter(Boolean).join(" · ")}</small>
              </td>
              <td>
                {test.failed + test.passed
                  ? `${Math.round((100 * test.failed) / (test.failed + test.passed))}%`
                  : "Unavailable"}{" "}
                · {test.failed}/{test.failed + test.passed}
                <small>
                  {test.skipped} skipped · {test.unavailable} unavailable · {test.missing} missing ·{" "}
                  {test.unknown} unknown · {test.ambiguous} ambiguous · {test.errors} errors
                </small>
              </td>
              <td>
                {test.transitions}
                {test.intermittent && " · Intermittent"}
              </td>
              <td>
                {model.evidence[test.key]?.label}{" "}
                {model.evidence[test.key] && ` [${model.evidence[test.key].source}]`}
                {test.outcomes[selectedIndex] === "failed" && (
                  <small>
                    Baseline:{" "}
                    {model.baseline?.status === "available"
                      ? {
                          failed: "Also failing",
                          passed: "Passing",
                          skipped: "Skipped",
                          ambiguous: "Ambiguous",
                          unknown: "Unknown",
                          missing: "Not present",
                          unavailable: "Unavailable",
                          error: "Error"
                        }[baselineCases.get(test.key) ?? "missing"]
                      : (model.baseline?.status ?? "Loading")}
                  </small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tests.length && <p>No matching test observations.</p>}
      <div className="history-toolbar">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
          Previous tests
        </button>
        <span>
          Page {currentPage + 1} of {Math.max(1, Math.ceil(tests.length / 50))}
        </span>
        <button
          type="button"
          disabled={(currentPage + 1) * 50 >= tests.length}
          onClick={() => setPage(currentPage + 1)}
        >
          Next tests
        </button>
      </div>
      {selectedTest && (
        <section aria-label="Selected test outcomes">
          <h3>{selectedTest.name}</h3>
          <p>Outcomes, newest first. Gaps break transition sequences.</p>
          <ol>
            {model.builds.map(({ build }, index) => (
              <li key={build.number}>
                <button type="button" onClick={() => send("openBuild", build.number)}>
                  #{build.number}
                </button>{" "}
                {selectedTest.outcomes[index]}{" "}
                <button type="button" onClick={() => send("compare", build.number)}>
                  Compare
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
  return (
    <section className="history-view" aria-label="Cross-build failure history">
      {embedded ? (
        <details>
          <summary>
            Failure history · {fresh} new · {continuing} continuing · {failedIntermittent}{" "}
            intermittent · {alsoFailing} baseline matches
          </summary>
          {content}
        </details>
      ) : (
        <>
          <h1>Job History</h1>
          <p>{model.jobUrl}</p>
          {content}
        </>
      )}
    </section>
  );
}
