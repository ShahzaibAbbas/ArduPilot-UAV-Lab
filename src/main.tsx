import "@xyflow/react/dist/style.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import "./stitch-fonts.css";
import "./styles.css";
import "./workbench.css";
import "./stitch-workbench.css";
import "./stitch-hci.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>
);
