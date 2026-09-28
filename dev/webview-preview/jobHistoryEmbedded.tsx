// Preview-only entry: the Job History view as Build Details embeds it ("Failure history").
import { HistoryProvider } from "../../src/panels/jobHistory/webview/HistoryContext";
import { HistoryView } from "../../src/panels/jobHistory/webview/HistoryView";
import { mountPanelApp } from "../../src/panels/shared/webview/mountPanelApp";
import "../../src/panels/shared/webview/styles/base.css";
import "../../src/panels/jobHistory/webview/styles.css";

const buildRunning = new URLSearchParams(window.location.search).get("running") === "1";

function EmbeddedHistoryPreview() {
  return (
    <HistoryProvider>
      <main className="mx-auto w-full max-w-6xl px-4 py-3">
        <HistoryView embedded buildRunning={buildRunning} />
      </main>
    </HistoryProvider>
  );
}
mountPanelApp(EmbeddedHistoryPreview, {});
