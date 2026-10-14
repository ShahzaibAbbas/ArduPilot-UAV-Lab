import type { FirmwareRecord } from "../../lib/api";

export function FirmwareMetadataPanel({ firmware }: { firmware: FirmwareRecord }) {
  return (
    <section className="firmware-metadata">
      <div className="firmware-metadata-title">
        <div>
          <strong>{firmware.originalName}</strong>
          <span>{firmware.detectedFormat}</span>
        </div>
        <span className={`status-pill ${firmware.compatibility.status === "compatible" ? "good" : firmware.compatibility.status === "incompatible" ? "bad" : "neutral"}`}>
          {firmware.compatibility.status}
        </span>
      </div>
      <dl>
        <div>
          <dt>Size</dt>
          <dd>{firmware.byteSize.toLocaleString()} bytes</dd>
        </div>
        <div>
          <dt>SHA-256</dt>
          <dd title={firmware.sha256}>{firmware.sha256.slice(0, 16)}…</dd>
        </div>
        <div>
          <dt>Board</dt>
          <dd>{firmware.metadata.boardId ?? firmware.selectedNode.board ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Vehicle</dt>
          <dd>{firmware.metadata.vehicleType ?? firmware.linkedSitlVehicle ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Git identity</dt>
          <dd>{firmware.metadata.gitIdentity ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Image</dt>
          <dd>{firmware.metadata.imageSize !== undefined ? `${firmware.metadata.imageSize.toLocaleString()} bytes reported by container` : "Opaque / not reported"}</dd>
        </div>
        <div>
          <dt>Uploaded</dt>
          <dd><time dateTime={firmware.uploadedAt}>{new Date(firmware.uploadedAt).toLocaleString()}</time></dd>
        </div>
        <div>
          <dt>Attached target</dt>
          <dd>{firmware.selectedNode.nodeId ?? "Library only"}</dd>
        </div>
      </dl>
      <p>{firmware.compatibility.message}</p>
      {firmware.warnings.map((warning) => (
        <p className="firmware-warning" key={warning}>
          {warning}
        </p>
      ))}
    </section>
  );
}
