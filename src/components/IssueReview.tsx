import { useEffect, useRef } from "react";
import { CheckCircle2, MapPin, Wrench, X } from "lucide-react";
import type { DesignEdge, DesignNode } from "../domain/design";
import { getPort } from "../domain/componentCatalog";
import type { ValidationIssue } from "../domain/validators";
import type { AutoWireSuggestion } from "../domain/autoWire";

export interface ReviewIssue extends Omit<ValidationIssue, "id"> {
  key: string;
  source: string;
  recommendation?: string;
}

export interface IssueLocation {
  label: string;
  nodeId?: string;
  edgeId?: string;
}

export interface IssueAutoFixAction {
  label: string;
  description: string;
  disabled?: boolean;
}

export function issueLocations(issue: ReviewIssue, nodes: DesignNode[], edges: DesignEdge[]): IssueLocation[] {
  const nodeLabel = (id: string) => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node ? `${node.data.label} (${id})` : `Missing component (${id})`;
  };
  const endpoint = (id: string, handle?: string | null) => {
    const node = nodes.find((candidate) => candidate.id === id);
    const port = node && getPort(node.data.componentType, handle);
    return `${nodeLabel(id)} · ${port?.label ?? handle ?? "unspecified port"}`;
  };
  const connections = (issue.edgeIds ?? []).map((id) => {
    const edge = edges.find((candidate) => candidate.id === id);
    return { edgeId: edge?.id, label: edge ? `${endpoint(edge.source, edge.sourceHandle)} → ${endpoint(edge.target, edge.targetHandle)}` : `Missing connection (${id})` };
  });
  const ports = (issue.portIds ?? []).map(({ nodeId, portId }) => ({
    nodeId: nodes.some((node) => node.id === nodeId) ? nodeId : undefined,
    label: endpoint(nodeId, portId)
  }));
  const components = [...new Set(issue.nodeIds ?? [])]
    .filter((id) => !issue.portIds?.some((port) => port.nodeId === id) && !issue.edgeIds?.some((edgeId) => {
      const edge = edges.find((candidate) => candidate.id === edgeId);
      return edge?.source === id || edge?.target === id;
    }))
    .map((id) => ({ nodeId: nodes.some((node) => node.id === id) ? id : undefined, label: nodeLabel(id) }));
  return [...connections, ...ports, ...components];
}

export function ValidationIssueList({ issues, nodes, edges, onReview }: {
  issues: ReviewIssue[];
  nodes: DesignNode[];
  edges: DesignEdge[];
  onReview: (issue: ReviewIssue) => void;
}) {
  return <div className="issue-list" aria-label="Current validation issues">
    {issues.length === 0 ? <div className="empty-state">No current validation issues.</div> : issues.map((issue) => {
      const locations = issueLocations(issue, nodes, edges);
      return <article className={`issue validation-issue ${issue.severity}`} key={issue.key} data-issue-key={issue.key}>
        <small className="issue-severity">{issue.severity}</small>
        <strong>{issue.title}</strong>
        <span>{issue.message}</span>
        <span className="issue-where"><MapPin size={13} />Where: {locations.map((location) => location.label).join("; ") || "Workspace configuration — component library or mission settings"}</span>
        <button type="button" onClick={() => onReview(issue)}>Review / resolve</button>
      </article>;
    })}
  </div>;
}

export function IssueReviewDialog({ selection, issue, nodes, edges, suggestions, autoFix, onAutoFix, onApplyWire, onLocate, onOpenLibrary, onOpenSettings, onClose }: {
  selection: { key: string; title: string } | null;
  issue: ReviewIssue | undefined;
  nodes: DesignNode[];
  edges: DesignEdge[];
  suggestions: AutoWireSuggestion[];
  autoFix?: IssueAutoFixAction | null;
  onAutoFix?: () => void;
  onApplyWire: (suggestion: AutoWireSuggestion) => void;
  onLocate: (location: IssueLocation) => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (selection && dialog && !dialog.open) dialog.showModal();
    if (!selection && dialog?.open) dialog.close();
  }, [selection]);
  const locations = issue ? issueLocations(issue, nodes, edges) : [];
  const relevantWires = issue ? suggestions.filter((wire) => issue.portIds?.length
    ? issue.portIds.some((port) => (port.nodeId === wire.targetId && port.portId === wire.targetHandle) || (port.nodeId === wire.sourceId && port.portId === wire.sourceHandle))
    : issue.nodeIds?.includes(wire.targetId) || issue.nodeIds?.includes(wire.sourceId)) : [];
  return <dialog ref={ref} className="issue-review-dialog" aria-labelledby="issue-review-title" onCancel={onClose}>
    {selection ? <>
      <header><div><small>{issue?.source ?? "Current design"}</small><h2 id="issue-review-title">{issue?.title ?? selection.title}</h2></div>
        <button type="button" className="icon-button" aria-label="Close issue review" onClick={onClose}><X size={19} /></button>
      </header>
      {issue ? <div className="issue-review-body">
        <section><h3>What is wrong</h3><p>{issue.message}</p></section>
        <section><h3>Where to fix it</h3>
          {locations.length ? <ul className="issue-locations">{locations.map((location, index) => <li key={`${location.edgeId ?? location.nodeId}-${index}`}>
            <span>{location.label}</span>
            {location.nodeId || location.edgeId ? <button type="button" onClick={() => onLocate(location)}>{location.edgeId ? "Inspect connection" : "Inspect component"}</button> : null}
          </li>)}</ul> : <p>This check concerns the workspace configuration. Review the required components and mission settings.</p>}
        </section>
        <section><h3>Resolve this issue?</h3><p>{issue.recommendation ?? "Inspect the affected item and correct its connections or properties. Checks update automatically after each edit."}</p>
          {relevantWires.length ? <div className="issue-wire-actions"><strong>Available connection repairs</strong>{relevantWires.map((wire) => <button type="button" key={wire.id} onClick={() => onApplyWire(wire)}>Connect: {wire.title}</button>)}</div> : null}
          {autoFix ? <div className="issue-auto-fix">
            <button className="issue-auto-fix-button" type="button" onClick={onAutoFix} disabled={autoFix.disabled || !onAutoFix}>
              <Wrench size={15} />
              {autoFix.label}
            </button>
            <small>{autoFix.description}</small>
          </div> : null}
          <div className="issue-review-tools"><button type="button" onClick={onOpenLibrary}>Open component library</button><button type="button" onClick={onOpenSettings}>Open mission settings</button></div>
        </section>
        <p className="scenario-note">“Not now” keeps this issue visible. It does not mark the design as passed.</p>
      </div> : <div className="issue-review-body issue-resolved" role="status"><CheckCircle2 size={28} /><h3>Resolved in the current design</h3><p>This issue no longer fails. Validation and acceptance results have updated automatically.</p></div>}
      <footer><button type="button" onClick={onClose}>{issue ? "Not now" : "Done"}</button></footer>
    </> : null}
  </dialog>;
}
