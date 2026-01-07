import { createRoot } from "react-dom/client";
import { BuildDetailsApp } from "./BuildDetailsApp";
import { getInitialState } from "./state/buildDetailsState";

const rootElement = document.getElementById("root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<BuildDetailsApp initialState={getInitialState()} />);
}
