import { createRoot } from "react-dom/client";
import { BuildDetailsApp } from "./BuildDetailsApp";
import { getInitialState } from "./state/buildDetailsState";
import "../../shared/webview/styles/base.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<BuildDetailsApp initialState={getInitialState()} />);
}
