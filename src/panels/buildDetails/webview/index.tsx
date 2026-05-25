import { mountPanelApp } from "../../shared/webview/mountPanelApp";
import { BuildDetailsApp } from "./BuildDetailsApp";
import { getInitialState } from "./state/buildDetailsState";
import "../../shared/webview/styles/base.css";
import "./styles.css";

mountPanelApp(BuildDetailsApp, { initialState: getInitialState() });
