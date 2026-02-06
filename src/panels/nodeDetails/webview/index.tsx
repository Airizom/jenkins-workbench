import { createRoot } from "react-dom/client";
import { NodeDetailsApp } from "./NodeDetailsApp";
import "../../shared/webview/styles/base.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<NodeDetailsApp />);
}
