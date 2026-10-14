import { Activity, Boxes, Cable, CircuitBoard, FileJson, FolderOpen, Gauge, GitCompareArrows, MapPin, Play, Radio, ScanLine, ScrollText, Search, Settings2, ShieldCheck, Terminal, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LabRunbook, type WorkflowStage } from "./LabWorkspaceChrome";

export type WorkbenchTab = "inspector" | "validation" | "simulation" | "mission" | "telemetry" | "firmware" | "trace" | "logs" | "terminal" | "performance" | "bom" | "params" | "compare" | "connections" | "files";

export const workbenchToolLabels: Record<WorkbenchTab, string> = {
  inspector: "Inspect",
  validation: "Validate",
  performance: "Performance",
  bom: "BOM",
  simulation: "SITL",
  mission: "Mission",
  telemetry: "Live",
  firmware: "Firmware",
  trace: "Trace",
  connections: "Ports & setup",
  files: "Workspace files",
  params: "Params",
  compare: "Compare",
  logs: "Logs",
  terminal: "Terminal"
};

const groups: Array<{ label: string; items: Array<{ id: WorkbenchTab; label: string; icon: LucideIcon }> }> = [
  { label: "DESIGN", items: [
    { id: "inspector", label: "Inspect", icon: Settings2 },
    { id: "validation", label: "Validate", icon: ShieldCheck },
    { id: "performance", label: "Performance", icon: Gauge },
    { id: "bom", label: "BOM", icon: FileJson }
  ] },
  { label: "SIMULATE & CONNECT", items: [
    { id: "simulation", label: "SITL", icon: Play },
    { id: "mission", label: "Mission", icon: MapPin },
    { id: "telemetry", label: "Live", icon: Radio },
    { id: "firmware", label: "Firmware", icon: CircuitBoard },
    { id: "trace", label: "Trace", icon: ScanLine }
  ] },
  { label: "WORKSPACE", items: [
    { id: "connections", label: "Ports & setup", icon: Cable },
    { id: "files", label: "Workspace files", icon: FolderOpen },
    { id: "params", label: "Params", icon: ScrollText },
    { id: "compare", label: "Compare", icon: GitCompareArrows },
    { id: "logs", label: "Logs", icon: Activity },
    { id: "terminal", label: "Terminal", icon: Terminal }
  ] }
];

interface WorkbenchNavigationProps {
  activeTab: WorkbenchTab | null;
  onSelect: (tab: WorkbenchTab) => void;
  onOpenLibrary: () => void;
  activeStage: WorkflowStage;
  onSelectStage: (stage: WorkflowStage) => void;
  domainProgress: string;
  connected: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function WorkbenchNavigation({ activeTab, onSelect, onOpenLibrary, activeStage, onSelectStage, domainProgress, connected, mobileOpen = false, onMobileClose }: WorkbenchNavigationProps) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter(({ label }) => searchTerms.every((term) => `${group.label} ${label}`.toLowerCase().includes(term)))
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mobileOpen && !dialog.open) {
      dialog.showModal();
      mobileSearchRef.current?.focus();
    }
    if (!mobileOpen && dialog.open) dialog.close();
  }, [mobileOpen]);

  const closeMobileTools = () => {
    dialogRef.current?.close();
    onMobileClose?.();
  };

  const selectTool = (nextTab: WorkbenchTab, mobile: boolean) => {
    onSelect(nextTab);
    if (mobile) closeMobileTools();
  };

  const openLibrary = (mobile: boolean) => {
    onOpenLibrary();
    if (mobile) closeMobileTools();
  };

  const selectStage = (stage: WorkflowStage, mobile: boolean) => {
    onSelectStage(stage);
    if (mobile) closeMobileTools();
  };

  const renderTools = (mobile: boolean) => <>
    <button className="navigation-library" type="button" title="Component library" aria-label="Component library" onClick={() => openLibrary(mobile)}><Boxes size={17} aria-hidden="true" /><span>Component library</span><span aria-hidden="true">+</span></button>
    <div className="navigation-search">
      <label>
        <Search size={15} aria-hidden="true" />
        <input
          ref={mobile ? mobileSearchRef : desktopSearchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find a tool"
          placeholder="Find a tool"
          autoFocus={mobile}
        />
      </label>
      {query ? <button className="navigation-search-clear" type="button" aria-label="Clear tool search" title="Clear tool search" onClick={() => {
        setQuery("");
        (mobile ? mobileSearchRef : desktopSearchRef).current?.focus();
      }}><X size={15} aria-hidden="true" /></button> : null}
    </div>
    <nav aria-label="Workspace tools">{filteredGroups.map((group) => <section className="navigation-group" key={group.label}>
      <h2>{group.label}</h2>
      {group.items.map(({ id, label, icon: Icon }) => <button key={id} type="button" title={label} aria-current={activeTab === id ? "page" : undefined} className={activeTab === id ? "active" : ""} onClick={() => selectTool(id, mobile)}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span>{id === "telemetry" && connected ? <i className="connection-dot" role="img" aria-label="Listener active" /> : null}
      </button>)}
    </section>)}</nav>
    {filteredGroups.length === 0 ? <p className="navigation-empty" role="status">No tools match “{query.trim()}”. Clear the search to see all tools.</p> : null}
    <details className="navigation-runbook"><summary>Mission runbook</summary><LabRunbook domainProgress={domainProgress} activeStage={activeStage} onOpenLibrary={() => openLibrary(mobile)} onSelectStage={(stage) => selectStage(stage, mobile)} /></details>
    <div className="navigation-footer"><span className={`connection-dot${connected ? "" : " inactive"}`} aria-hidden="true" /><span>Local engineering lab</span></div>
  </>;

  return <>
    <aside id="workbench-navigation" className="workbench-navigation" aria-label="Workspace navigation">
      <div className="navigation-intro"><span className="navigation-monogram"><Boxes size={20} aria-hidden="true" /></span><div><strong>Engineering workspace</strong><small>Design · verify · fly</small></div></div>
      {renderTools(false)}
    </aside>
    <dialog
      id="workbench-tool-dialog"
      ref={dialogRef}
      className="workbench-tool-dialog"
      aria-labelledby="workbench-tool-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeMobileTools();
      }}
    >
      <header className="mobile-tools-heading">
        <h2 id="workbench-tool-dialog-title">Workspace tools</h2>
        <button type="button" onClick={closeMobileTools}><X size={18} aria-hidden="true" /><span>Close tools</span></button>
      </header>
      <div className="mobile-tools-navigation">{renderTools(true)}</div>
    </dialog>
  </>;
}
