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
  edgeIds?: string[];
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
  designSaved?: boolean;
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
  designSaved = false,
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
          <span>SYSTEMS ENGINEERING</span>
        </div>
      </div>

      <label className="lab-project-name">
        <span>Project</span>
        <input value={designName} onChange={(event) => onDesignNameChange(event.target.value)} aria-label="Project name" />
        <small className={`project-save-state ${designSaved ? "saved" : "pending"}`} role="status">
          {designSaved ? "Snapshot saved" : "Changes not saved"}
        </small>
        <small className="lab-mobile-stage">Stage {stageIndex + 1}/{workflowStages.length} · {activeStage.title}</small>
      </label>

      <div className="lab-stage-title" aria-label="Current workflow stage">
        <div className="lab-stage-count">
          <small>Stage {stageIndex + 1} of {workflowStages.length}</small>
          <div className="lab-stage-progress" aria-hidden="true">
            {workflowStages.map((step, index) => (
              <span key={step.id} className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""} />
            ))}
          </div>
        </div>
        <strong>{activeStage.title}</strong>
        <span>{activeStage.description}</span>
      </div>

      <div className="lab-header-actions">
        <div className="lab-history-actions" role="group" aria-label="Workspace history">
        <button className="lab-icon-action" type="button" onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button className="lab-icon-action" type="button" onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
          <Redo2 size={17} aria-hidden="true" />
        </button>
        </div>
        <button className="lab-save-action" type="button" onClick={onSave}>
          <Save size={17} aria-hidden="true" />
          Save snapshot
        </button>
        <button className="lab-primary-action" type="button" onClick={onComplete}>
          <Check size={18} aria-hidden="true" />
          {stage === "integrate" ? "Review integration" : stage === "verify" ? "Continue to simulation" : stage === "simulate" ? "Open simulation tools" : "Continue setup"}
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
        <BookOpenCheck size={19} aria-hidden="true" />
        <strong>Lab runbook</strong>
      </div>
      <ol>
        {workflowStages.map((step, index) => (
          <li key={step.id} className={step.id === activeStage ? "active" : index < activeIndex ? "complete" : ""}>
            <button type="button" onClick={() => onSelectStage(step.id)} aria-current={step.id === activeStage ? "step" : undefined}>
              <span className="lab-step-index">{index < activeIndex ? <Check size={16} aria-hidden="true" /> : index + 1}</span>
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
          <Library size={17} aria-hidden="true" />
          <span>
            <strong>Component library</strong>
            <small>Add electrical, mechanical, control, and payload systems</small>
          </span>
        </button>
        <a href="https://ardupilot.org/copter/docs/common-autopilots.html" target="_blank" rel="noreferrer">
          <HelpCircle size={17} aria-hidden="true" />
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
        const actionCount = domain.checks.filter((check) => !check.passed && check.severity !== "info").length;
        const hasIssue = actionCount > 0;
        return (
          <button
            key={domain.id}
            type="button"
            className={activeDomain === domain.id ? "active" : ""}
            onClick={() => onChange(domain.id)}
            aria-current={activeDomain === domain.id ? "page" : undefined}
          >
            <Icon size={17} aria-hidden="true" />
            <span>
              <strong>{domain.shortLabel ?? domain.label}</strong>
              <small>{domain.completed}/{domain.total} checks{hasIssue ? <span className="domain-action-badge">{actionCount} {actionCount === 1 ? "action" : "actions"}</span> : null}</small>
            </span>
            {hasIssue ? <Circle className="domain-attention" size={8} fill="currentColor" aria-hidden="true" /> : null}
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
  onAutoFix: () => void;
  autoFixCount: number;
  onOpenTools: () => void;
}

export function DomainReviewPanel({ domain, onShowAffected, onRunCheck, onAutoFix, autoFixCount, onOpenTools }: DomainReviewPanelProps) {
  const issue = domain.checks.find((check) => !check.passed && check.severity !== "info");
  const passedChecks = domain.checks.filter((check) => check.passed).length;
  const remainingChecks = Math.max(0, domain.total - domain.completed);
  const orderedChecks = [
    ...domain.checks.filter((check) => !check.passed),
    ...domain.checks.filter((check) => check.passed)
  ];
  return (
    <div className="domain-review">
      <div className="domain-review-heading">
        <div>
          <small>Domain review</small>
          <h2>{domain.label} check</h2>
        </div>
        <button type="button" onClick={onOpenTools}>Workspace tools</button>
      </div>
      <div className="domain-progress">
        <div className="domain-progress-summary">
          <strong>{domain.completed}<span> / {domain.total} checks complete</span></strong>
          <small>{remainingChecks} {remainingChecks === 1 ? "check" : "checks"} remaining</small>
        </div>
        <progress value={domain.completed} max={Math.max(1, domain.total)} aria-label={`${domain.label} completion`}>
          {domain.completed} of {domain.total} checks complete
        </progress>
      </div>
      <section className="domain-objective">
        <h3>Objective</h3>
        <p>{domain.description}</p>
      </section>
      <section className="domain-checks">
        <h3>Acceptance checks <span className="domain-check-count" aria-hidden="true">{passedChecks}/{domain.checks.length}</span></h3>
        <p className="scenario-note">Results update automatically as you edit. Review any remaining issue to find its location and available repairs.</p>
        {orderedChecks.map((check) => (
          <article key={check.id} data-check-id={check.id} className={check.passed ? "passed" : `issue ${check.severity ?? "warning"}`}>
            {check.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <div>
              <strong>{check.label}</strong>
              <span>{check.detail}</span>
              {!check.passed && check.recommendation ? <em>{check.recommendation}</em> : null}
              {!check.passed ? <button className="check-review-action" type="button" onClick={() => onShowAffected(check)}>Review / resolve</button> : null}
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
        <p>{issue ? "Choose an issue to inspect or repair. Corrected issues clear automatically." : "This domain is ready. Continue to the next incomplete discipline."}</p>
        <button className="domain-auto-fix" type="button" onClick={onAutoFix} disabled={autoFixCount === 0}>
          <Zap size={16} aria-hidden="true" />
          {autoFixCount > 0 ? `Auto-fix ${autoFixCount} safe connection${autoFixCount === 1 ? "" : "s"}` : "No safe auto-fixes available"}
        </button>
          <small className="domain-auto-fix-note">This panel repairs compatible missing wires. Open a failed check for contextual repairs such as a rated harness baseline; review component and rating choices before flight use.</small>
        {issue ? (
          <button className="domain-secondary-action" type="button" onClick={() => onShowAffected(issue)}>
            Review next issue
          </button>
        ) : null}
        <button className="domain-primary-action" type="button" onClick={onRunCheck}>
          <CheckCircle2 size={17} aria-hidden="true" />
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
        <small>{designSaved ? "Workspace saved" : "Save to keep your changes"}</small>
      </div>
      <div className="lab-evidence-track" aria-hidden="true">
        <span className="complete" />
        <span className={validationReady ? "complete" : "active"} />
        <span className={simulationRan ? "complete" : ""} />
      </div>
      <div className="lab-evidence-items">
        <button type="button" onClick={onSave}>
          <span className="lab-evidence-index" aria-hidden="true">01</span>
          <Boxes size={24} aria-hidden="true" />
          <span><strong>Design snapshot</strong><small>{domainLabel}</small><em>{designSaved ? "Saved" : "Save current revision"}</em></span>
        </button>
        <button type="button" onClick={onOpenValidation} className={validationReady ? "complete" : "active"}>
          <span className="lab-evidence-index" aria-hidden="true">02</span>
          <FileCheck2 size={24} aria-hidden="true" />
          <span><strong>Domain verification report</strong><small>Stage 4 · Integrate systems</small><em>{validationReady ? "Ready" : "Pending review"}</em></span>
        </button>
        <button type="button" onClick={onOpenSimulation}>
          <span className="lab-evidence-index" aria-hidden="true">03</span>
          <Play size={24} aria-hidden="true" />
          <span><strong>Simulation result</strong><small>Stage 6 · Run simulation</small><em>{simulationRan ? "Scenario recorded" : "Not run"}</em></span>
        </button>
      </div>
    </section>
  );
}

export function domainIconFor(id: EngineeringDomainId) {
  return domainIcons[id] ?? Gauge;
}
