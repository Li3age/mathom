import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyStoredTheme } from "./lib/theme";
import { applyLang, loadLang } from "./lib/i18n";
import "./index.css";

applyStoredTheme();
applyLang(loadLang());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
