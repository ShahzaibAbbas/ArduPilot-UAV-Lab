import {
  BookOpenCheck,
  Boxes,
  Cable,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  FileCheck2,
  Gauge,
  HelpCircle,
  Library,
  Play,
  Radio,
  Redo2,
  Rotate3D,
  Save,
  ShieldCheck,
  Undo2,
  Wrench,
  XCircle,
  Zap,
  type LucideIcon
} from "lucide-react";

export type EngineeringDomainId =
  | "electrical-power"
  | "wiring-buses"
  | "mechanical-mounting"
  | "propulsion"
  | "avionics-sensors"
  | "communications"
  | "safety";

export type WorkflowStage = "define" | "airframe" | "systems" | "integrate" | "verify" | "simulate";

export const workflowStages: Array<{ id: WorkflowStage; label: string; title: string; hint: string; description: string }> = [
  { id: "define", label: "Define mission", title: "Define the mission", hint: "Map the goal and constraints", description: "Turn the intended outcome into measurable operating requirements." },
  { id: "airframe", label: "Choose airframe", title: "Choose the airframe", hint: "Select platform and size", description: "Match the vehicle family and geometry to the mission." },
  { id: "systems", label: "Add systems", title: "Add mission systems", hint: "Pick required components", description: "Load the electrical, wiring, mechanical, avionics, payload, and safety baseline." },
  { id: "integrate", label: "Integrate systems", title: "Integrate systems", hint: "Connect and validate all domains", description: "Bring every engineering domain together and validate interfaces." },
  { id: "verify", label: "Verify design", title: "Verify the design", hint: "Run checks and review", description: "Resolve errors and record multidisciplinary verification evidence." },
  { id: "simulate", label: "Run simulation", title: "Build and simulate", hint: "Test performance and behavior", description: "Build ArduPilot firmware and exercise the mission in SITL." }
];

export interface EngineeringCheckView {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  severity?: "error" | "warning" | "info";
  nodeIds?: string[];
  recommendation?: string;
}

export interface EngineeringDomainView {
  id: EngineeringDomainId;
  label: string;
  shortLabel?: string;
  description: string;
  completed: number;
  total: number;
  checks: EngineeringCheckView[];
}

const domainIcons: Record<EngineeringDomainId, LucideIcon> = {
  "electrical-power": Zap,
  "wiring-buses": Cable,
  "mechanical-mounting": Wrench,
  propulsion: Rotate3D,
  "avionics-sensors": Cpu,
  communications: Radio,
  safety: ShieldCheck
};

interface LabHeaderProps {
  designName: string;
  stage: WorkflowStage;
  onDesignNameChange: (value: string) => void;
  onSave: () => void;
  onComplete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function LabHeader({
  designName,
  stage,
  onDesignNameChange,
  onSave,
  onComplete,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: LabHeaderProps) {
  const stageIndex = Math.max(0, workflowStages.findIndex((candidate) => candidate.id === stage));
  const activeStage = workflowStages[stageIndex];
  return (
    <header className="lab-topbar">
      <div className="lab-brand">
        <img src="/uas-doctoral-tech-logo.png" alt="UAS Doctoral Tech" />
        <div>
          <strong>ArduPilot UAV Lab</strong>
          <span>Guided systems notebook</span>
        </div>
      </div>

      <label className="lab-project-name">
        <span>Project</span>
        <input value={designName} onChange={(event) => onDesignNameChange(event.target.value)} aria-label="Project name" />
      </label>

      <div className="lab-stage-title" aria-label="Current workflow stage">
        <small>Stage {stageIndex + 1} of {workflowStages.length}</small>
        <strong>{activeStage.title}</strong>
        <span>{activeStage.description}</span>
      </div>

      <div className="lab-header-actions">
        <button className="lab-icon-action" type="button" onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
          <Undo2 size={17} />
        </button>
        <button className="lab-icon-action" type="button" onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
          <Redo2 size={17} />
        </button>
        <button className="lab-save-action" type="button" onClick={onSave}>
          <Save size={17} />
          Save
        </button>
        <button className="lab-primary-action" type="button" onClick={onComplete}>
          <Check size={18} />
          {stage === "integrate" ? "Complete integration review" : stage === "verify" ? "Continue to simulation" : stage === "simulate" ? "Open simulation tools" : "Continue setup"}
        </button>
      </div>
    </header>
  );
}

interface LabRunbookProps {
  domainProgress: string;
  activeStage: WorkflowStage;
  onOpenLibrary: () => void;
  onSelectStage: (stage: WorkflowStage) => void;
}

export function LabRunbook({ domainProgress, activeStage, onOpenLibrary, onSelectStage }: LabRunbookProps) {
  const activeIndex = Math.max(0, workflowStages.findIndex((step) => step.id === activeStage));
  return (
    <aside className="lab-runbook" aria-label="Lab runbook">
      <div className="lab-runbook-title">
        <BookOpenCheck size={19} />
        <strong>Lab runbook</strong>
      </div>
      <ol>
        {workflowStages.map((step, index) => (
          <li key={step.id} className={step.id === activeStage ? "active" : index < activeIndex ? "complete" : ""}>
            <button type="button" onClick={() => onSelectStage(step.id)} aria-current={step.id === activeStage ? "step" : undefined}>
              <span className="lab-step-index">{index < activeIndex ? <Check size={16} /> : index + 1}</span>
              <span className="lab-step-copy">
                <strong>{step.label}</strong>
                <small>{step.hint}</small>
                {step.id === "integrate" ? <em>{domainProgress}</em> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="lab-runbook-actions">
        <button type="button" onClick={onOpenLibrary}>
          <Library size={17} />
          <span>
            <strong>Component library</strong>
            <small>Add electrical, mechanical, control, and payload systems</small>
          </span>
        </button>
        <a href="https://ardupilot.org/copter/docs/common-autopilots.html" target="_blank" rel="noreferrer">
          <HelpCircle size={17} />
          Open integration guide
        </a>
      </div>
    </aside>
  );
}

interface DomainStripProps {
  domains: EngineeringDomainView[];
  activeDomain: EngineeringDomainId;
  onChange: (domain: EngineeringDomainId) => void;
}

export function DomainStrip({ domains, activeDomain, onChange }: DomainStripProps) {
  return (
    <nav className="domain-strip" aria-label="Engineering domains">
      {domains.map((domain) => {
        const Icon = domainIcons[domain.id];
        const hasIssue = domain.checks.some((check) => !check.passed && check.severity !== "info");
        return (
          <button
            key={domain.id}
            type="button"
            className={activeDomain === domain.id ? "active" : ""}
            onClick={() => onChange(domain.id)}
            aria-current={activeDomain === domain.id ? "page" : undefined}
          >
            <Icon size={17} />
            <span>
              <strong>{domain.shortLabel ?? domain.label}</strong>
              <small>{domain.completed}/{domain.total} checks</small>
            </span>
            {hasIssue ? <Circle className="domain-attention" size={8} fill="currentColor" aria-label="Needs attention" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

interface DomainReviewPanelProps {
  domain: EngineeringDomainView;
  onShowAffected: (check: EngineeringCheckView) => void;
  onRunCheck: () => void;
  onOpenTools: () => void;
}

export function DomainReviewPanel({ domain, onShowAffected, onRunCheck, onOpenTools }: DomainReviewPanelProps) {
  const issue = domain.checks.find((check) => !check.passed && check.severity !== "info");
  return (
    <div className="domain-review">
      <div className="domain-review-heading">
        <div>
          <small>Active domain</small>
          <h2>{domain.label} check</h2>
        </div>
        <button type="button" onClick={onOpenTools}>Workspace tools</button>
      </div>
      <section className="domain-objective">
        <h3>Objective</h3>
        <p>{domain.description}</p>
      </section>
      <section className="domain-checks">
        <h3>Acceptance checks</h3>
        {domain.checks.map((check) => (
          <article key={check.id} className={check.passed ? "passed" : `issue ${check.severity ?? "warning"}`}>
            {check.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
              {!check.passed && check.recommendation ? <em>{check.recommendation}</em> : null}
            </div>
          </article>
        ))}
      </section>
      <details className="domain-why">
        <summary>Why this matters</summary>
        <p>Domain checks catch interface failures before they become damaged hardware, unstable flight behavior, or an unsafe field test.</p>
      </details>
      <section className="domain-next-action">
        <h3>Next action</h3>
        <p>{issue ? "Resolve the highlighted issue, then run this domain check again." : "This domain is ready. Continue to the next incomplete discipline."}</p>
        {issue ? (
          <button className="domain-secondary-action" type="button" onClick={() => onShowAffected(issue)}>
            Show affected path
          </button>
        ) : null}
        <button className="domain-primary-action" type="button" onClick={onRunCheck}>
          <CheckCircle2 size={17} />
          Re-run {domain.shortLabel ?? domain.label} check
        </button>
      </section>
    </div>
  );
}

interface LabEvidenceProps {
  domainLabel: string;
  designSaved: boolean;
  validationReady: boolean;
  simulationRan: boolean;
  onSave: () => void;
  onOpenValidation: () => void;
  onOpenSimulation: () => void;
}

export function LabEvidence({
  domainLabel,
  designSaved,
  validationReady,
  simulationRan,
  onSave,
  onOpenValidation,
  onOpenSimulation
}: LabEvidenceProps) {
  return (
    <section className="lab-evidence" aria-label="Lab evidence">
      <div className="lab-evidence-intro">
        <strong>Lab evidence</strong>
        <span>Your work and verification state stay together.</span>
        <small>{designSaved ? "Workspace saved" : "Unsaved changes are tracked locally"}</small>
      </div>
      <div className="lab-evidence-track" aria-hidden="true">
        <span className="complete" />
        <span className={validationReady ? "complete" : "active"} />
        <span className={simulationRan ? "complete" : ""} />
      </div>
      <div className="lab-evidence-items">
        <button type="button" onClick={onSave}>
          <Boxes size={24} />
          <span><strong>Design snapshot</strong><small>{domainLabel}</small><em>{designSaved ? "Saved" : "Save current revision"}</em></span>
        </button>
        <button type="button" onClick={onOpenValidation} className={validationReady ? "complete" : "active"}>
          <FileCheck2 size={24} />
          <span><strong>Domain verification report</strong><small>Stage 4 · Integrate systems</small><em>{validationReady ? "Ready" : "Pending review"}</em></span>
        </button>
        <button type="button" onClick={onOpenSimulation}>
          <Play size={24} />
          <span><strong>Simulation result</strong><small>Stage 6 · Run simulation</small><em>{simulationRan ? "Scenario recorded" : "Not run"}</em></span>
        </button>
      </div>
    </section>
  );
}

export function domainIconFor(id: EngineeringDomainId) {
  return domainIcons[id] ?? Gauge;
}
