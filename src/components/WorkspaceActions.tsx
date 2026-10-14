import { FilePlus, FolderOpen, RotateCcw, Save } from "lucide-react";

interface WorkspaceActionsProps {
  onNew: () => void;
  onReset: () => void;
  onSave: () => void;
  onLoad: () => void;
}

export function WorkspaceActions({ onNew, onReset, onSave, onLoad }: WorkspaceActionsProps) {
  return (
    <div className="workspace-actions" role="group" aria-label="Workspace files">
      <button type="button" title="Start a new mission workspace (Ctrl+N)" aria-keyshortcuts="Control+N" onClick={onNew}>
        <FilePlus size={15} /><span>New</span>
      </button>
      <button type="button" title="Reset workspace to starter design (Ctrl+Shift+R)" aria-keyshortcuts="Control+Shift+R" onClick={onReset}>
        <RotateCcw size={15} /><span>Reset</span>
      </button>
      <button type="button" title="Save current space as .saq (Ctrl+Shift+S)" aria-keyshortcuts="Control+Shift+S" onClick={onSave}>
        <Save size={15} /><span>Save .saq</span>
      </button>
      <button type="button" title="Load a .saq workspace (Ctrl+O)" aria-keyshortcuts="Control+O" onClick={onLoad}>
        <FolderOpen size={15} /><span>Load</span>
      </button>
    </div>
  );
}
