import { useState } from "react";
import { Power } from "lucide-react";
import { exitApplication } from "../lib/api";

export function ExitApplicationButton() {
  const [state, setState] = useState<"idle" | "stopping" | "requested">("idle");
  const [error, setError] = useState("");
  const exit = async () => {
    setState("stopping");
    setError("");
    try { await exitApplication(); setState("requested"); }
    catch (reason) {
      setState("idle");
      setError(reason instanceof Error ? reason.message : "The exit request failed. Check the local server and try again.");
    }
  };
  return <section>
    <h2>Exit the lab</h2>
    <p className="panel-footnote">Save your workspace first. Exit stops managed SITL, companion VMs, terminal and build processes, telemetry, and the local API. The app launcher also closes its browser and Vite server.</p>
    <button type="button" className="guide-action" disabled={state !== "idle"} onClick={() => void exit()}><Power size={16} />{state === "idle" ? "Exit application" : "Shutting down…"}</button>
    {state === "requested" ? <p role="status">Shutdown requested. A browser opened separately can be closed after the launcher finishes.</p> : null}
    {error ? <p className="panel-error" role="alert">{error}</p> : null}
  </section>;
}
