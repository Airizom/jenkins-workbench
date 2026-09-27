import { mountPanelApp } from "../../shared/webview/mountPanelApp";
import { HistoryProvider } from "./HistoryContext";
import { HistoryView } from "./HistoryView";
import "../../shared/webview/styles/base.css";
import "./styles.css";

function JobHistoryApp() {
  return (
    <HistoryProvider>
      <HistoryView />
    </HistoryProvider>
  );
}
mountPanelApp(JobHistoryApp, {});
