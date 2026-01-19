import { createRoot } from "react-dom/client";
import { NodeDetailsApp } from "./NodeDetailsApp";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<NodeDetailsApp />);
}
