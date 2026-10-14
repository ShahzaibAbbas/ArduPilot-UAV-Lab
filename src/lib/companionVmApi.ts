export interface CompanionVm {
  nodeId: string;
  state: "starting" | "running" | "stopping" | "stopped" | "failed";
  diskExists: boolean;
  memoryMb: number;
  cpus: number;
  diskGb: number;
  boot: "installer" | "disk";
  displayMode?: "vnc" | "window";
  vncPort?: number;
  pid?: number;
  error?: string;
}

export interface CompanionVmStatus {
  runtime: { available: boolean; qemuAvailable: boolean; qemuImgAvailable: boolean; message: string };
  machines: CompanionVm[];
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "The companion VM request failed. Check the local API and QEMU installation.");
  }
  return response.json() as Promise<T>;
}

export async function getCompanionVms(signal?: AbortSignal) {
  return responseJson<CompanionVmStatus>(await fetch("/api/companion-vm", { signal }));
}

export async function startCompanionVm(nodeId: string, settings: {
  memoryMb: number; cpus: number; diskGb: number; boot: "installer" | "disk"; displayMode?: "vnc" | "window"; isoPath?: string;
}) {
  return responseJson<{ machine: CompanionVm }>(await fetch(`/api/companion-vm/${encodeURIComponent(nodeId)}/start`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings)
  }));
}

export async function stopCompanionVm(nodeId: string) {
  return responseJson<{ machine: CompanionVm }>(await fetch(`/api/companion-vm/${encodeURIComponent(nodeId)}/stop`, { method: "POST" }));
}
