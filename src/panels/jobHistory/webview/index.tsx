import { mountPanelApp } from "../../shared/webview/mountPanelApp";
import "../../shared/webview/styles/base.css";
import { HistoryProvider } from "./HistoryProvider";
import { HistoryView } from "./HistoryView";
import "./styles.css";

function JobHistoryApp() {
  return (
    <HistoryProvider>
      <HistoryView />
    </HistoryProvider>
  );
}
mountPanelApp(JobHistoryApp, {});
