import { createRoot } from "react-dom/client";
import { BuildDetailsApp, getInitialState } from "./BuildDetailsApp";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<BuildDetailsApp initialState={getInitialState()} />);
}
