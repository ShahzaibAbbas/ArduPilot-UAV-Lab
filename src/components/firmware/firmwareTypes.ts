export type { FirmwareRecord, FirmwareWorkflow, FirmwareWorkflowState } from "../../lib/api";

export interface UnifiedFirmwareEvent {
  id: string;
  timestamp: string;
  origin: "workflow simulation" | "SITL" | "MAVLink RX" | "MAVLink TX";
  state: string;
  message: string;
}

