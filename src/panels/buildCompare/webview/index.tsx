import { createRoot } from "react-dom/client";
import { BuildCompareApp } from "./BuildCompareApp";
import { getInitialState } from "./state/buildCompareState";
import "../../shared/webview/styles/base.css";
import "./styles.css";

const rootElement = document.getElementById("root");
const initialState = getInitialState();

if (rootElement && initialState) {
  const root = createRoot(rootElement);
  root.render(<BuildCompareApp initialState={initialState} />);
}
