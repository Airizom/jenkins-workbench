import { createRoot } from "react-dom/client";
import { NodeCapacityApp } from "./NodeCapacityApp";
import "../../shared/webview/styles/base.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<NodeCapacityApp />);
}
