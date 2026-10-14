import type { FirmwareWorkflow, FirmwareWorkflowState } from "../../lib/api";

const states: FirmwareWorkflowState[] = ["VALIDATING", "READY", "ERASING", "FLASHING", "VERIFYING", "BOOTING", "RUNNING"];

interface FirmwareStateTimelineProps {
  workflow?: FirmwareWorkflow;
}

export function FirmwareStateTimeline({ workflow }: FirmwareStateTimelineProps) {
  const activeIndex = workflow ? states.indexOf(workflow.state) : -1;
  const reached = new Set(workflow?.events.map((event) => event.state));
  return (
    <section className="firmware-state-timeline" aria-label="Visual firmware workflow state">
      <div className="firmware-progress-copy">
        <strong>{workflow?.state ?? "EMPTY"}</strong>
        <span>{workflow && workflow.state !== "EMPTY" ? `${workflow.progress}% · ${Math.round(workflow.elapsedMs / 100) / 10}s` : "Ready to start a workflow simulation"}</span>
      </div>
      <progress aria-label="Visual firmware simulation progress" max={100} value={workflow?.progress ?? 0} />
      {workflow?.state === "FAILED" ? <p className="firmware-warning" role="status">{workflow.events.at(-1)?.message}</p> : null}
      <ol>
        {states.map((state, index) => (
          <li aria-current={state === workflow?.state ? "step" : undefined} className={state === workflow?.state ? "active" : index < activeIndex || reached.has(state) ? "complete" : ""} key={state}>
            <span>{index + 1}</span>
            <small>{state}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
