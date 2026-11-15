import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app.css";
import App from "./App.jsx";
import { initTheme } from "./lib/theme.js";
import { initLang } from "./lib/i18n.js";

initTheme();
initLang();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);