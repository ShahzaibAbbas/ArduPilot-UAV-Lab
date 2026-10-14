import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

interface FirmwareDropzoneProps {
  disabled: boolean;
  uploading?: boolean;
  targetLabel?: string;
  uploadLimitBytes?: number;
  onFile: (file: File) => void;
  onError: (message: string) => void;
}

export function FirmwareDropzone({ disabled, uploading, targetLabel, uploadLimitBytes, onFile, onError }: FirmwareDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const descriptionId = useId();
  const [dragging, setDragging] = useState(false);
  const limit = uploadLimitBytes === undefined ? "configured limit" : uploadLimitBytes >= 1024 * 1024
    ? `${(uploadLimitBytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
    : `${(uploadLimitBytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  return (
    <section
      className={`firmware-dropzone${dragging ? " is-dragging" : ""}`}
      aria-label="Firmware upload"
      aria-busy={uploading}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        setDragging(!disabled);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        if (event.dataTransfer.files.length !== 1) {
          onError("Drop one firmware file at a time.");
          return;
        }
        onFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        data-testid="firmware-file-input"
        type="file"
        accept=".apj,.bin,.hex,.elf"
        aria-label="Choose firmware file"
        aria-describedby={descriptionId}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <Upload size={17} />
        {uploading ? "Uploading…" : dragging ? "Drop firmware here" : "Choose firmware"}
      </button>
      <div>
        <strong>{targetLabel ? `Target: ${targetLabel}` : "Select a flight controller to attach firmware"}</strong>
        <span id={descriptionId}>Choose or drop one .apj, .bin, .hex, or .elf file · maximum {limit}</span>
      </div>
    </section>
  );
}
