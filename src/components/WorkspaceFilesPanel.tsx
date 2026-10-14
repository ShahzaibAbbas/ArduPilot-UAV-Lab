import { useEffect, useState } from "react";
import { FileBox, FolderOpen, RefreshCw, Save, Search } from "lucide-react";
import { listDesigns } from "../lib/api";
import type { UavDesign } from "../domain/design";

export function WorkspaceFilesPanel({ onLoad, onBrowse, onSave }: { onLoad: (design: UavDesign) => void; onBrowse: () => void; onSave: () => void }) {
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [designs, setDesigns] = useState<UavDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      listDesigns(query).then(result => { if (active) setDesigns(result.designs); })
        .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Cannot read saved workspaces."); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, revision]);
  return <div className="detail-content workspace-files-panel">
    <div className="panel-title"><span>Workspace files</span><button className="icon-button" type="button" aria-label="Refresh saved workspaces" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={16} /></button></div>
    <p className="panel-introduction">Continue a saved design, or open a .saq file from your computer. Saved snapshots are discovered automatically.</p>
    <div className="file-actions"><button type="button" onClick={onBrowse}><FolderOpen size={17} />Browse .saq / JSON</button><button type="button" onClick={onSave}><Save size={17} />Save current workspace</button></div>
    <label className="search-box"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, vehicle or frame…" aria-label="Search saved workspaces" maxLength={200} /></label>
    <div className="file-list-heading"><h2>Saved on this server</h2><span>{loading ? "Searching…" : `${designs.length} found`}</span></div>
    {error ? <p className="panel-error" role="alert">{error}</p> : null}
    {!error && !loading && !designs.length ? <div className="workspace-empty"><FileBox size={32} /><strong>{query ? "No matching workspaces" : "Your designs start here"}</strong><p>{query ? "Try a different name, vehicle or frame." : "Save the current workspace to add it to this list."}</p></div> : null}
    {!error && !loading ? <div className="saved-design-list">{designs.map((design, index) => <button type="button" key={design.id ?? index} onClick={() => { try { onLoad(design); } catch (reason) { setError(reason instanceof Error ? reason.message : "This workspace cannot be opened."); } }}>
      <FileBox size={22} /><span><strong>{design.name}</strong><small>{String(design.settings.vehicle ?? "Vehicle")} · {String(design.settings.frame ?? "Frame")}</small><em>{design.nodes.length} components · {design.edges.length} connections</em></span><FolderOpen size={16} />
    </button>)}</div> : null}
    <p className="panel-footnote">The search covers snapshots saved by this lab. Use Browse to open files elsewhere on your computer.</p>
  </div>;
}
