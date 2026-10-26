import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import { AppProvider } from "./store";
import { UIProvider } from "./uiState";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <UIProvider>
      <Root />
    </UIProvider>
  </AppProvider>
);
