import { mountPanelApp } from "../../shared/webview/mountPanelApp";
import { BuildCompareApp } from "./BuildCompareApp";
import { getInitialState } from "./state/buildCompareState";
import "../../shared/webview/styles/base.css";
import "./styles.css";

const initialState = getInitialState();
if (initialState) {
  mountPanelApp(BuildCompareApp, { initialState });
}
