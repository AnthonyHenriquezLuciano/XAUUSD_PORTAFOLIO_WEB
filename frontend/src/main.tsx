import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import { AppProvider } from "./store";
import { UIProvider } from "./uiState";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <UIProvider>
      <Root />
    </UIProvider>
  </AppProvider>
);
