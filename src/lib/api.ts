import type { UavDesign } from "../domain/design";

export interface SystemStatus {
  sitl: {
    available: boolean;
    path?: string;
    command?: string;
    notes: string[];
  };
}

export interface SitlPlan {
  available: boolean;
  commandLine: string;
  command?: string;
  args: string[];
  cwd: string;
  paramFile?: string;
  outputs?: Array<{ id?: string; name: string; host: string; port: number }>;
  notes: string[];
}

export interface SoftwareUpdateResult {
  updated: boolean;
  message: string;
  steps: Array<{ command: string; output: string }>;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getSystemStatus() {
  return parseResponse<SystemStatus>(await fetch("/api/system"));
}

export async function locateSimVehicle(simVehiclePath: string) {
  return parseResponse<SystemStatus>(
    await fetch("/api/sitl/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simVehiclePath })
    })
  );
}

export async function saveDesign(design: UavDesign) {
  return parseResponse<{ design: UavDesign }>(
    await fetch("/api/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function listDesigns() {
  return parseResponse<{ designs: UavDesign[] }>(await fetch("/api/designs"));
}

export async function buildParamFile(design: UavDesign) {
  return parseResponse<{ fileName: string; content: string }>(
    await fetch("/api/export/params", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildSitlPlan(design: UavDesign) {
  return parseResponse<{ plan: SitlPlan }>(
    await fetch("/api/sitl/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function launchSitl(design: UavDesign) {
  return parseResponse<{ pid: number; plan: SitlPlan }>(
    await fetch("/api/sitl/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function updateSoftware() {
  return parseResponse<SoftwareUpdateResult>(
    await fetch("/api/software/update", {
      method: "POST"
    })
  );
}
