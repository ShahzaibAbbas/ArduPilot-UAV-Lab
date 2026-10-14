import type { SitlProcessStatus } from "./api";

interface ProcessApi {
  list: (signal: AbortSignal) => Promise<SitlProcessStatus>;
  stop: (pid: number, signal: AbortSignal) => Promise<unknown>;
}

interface StopOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  onStatus?: (status: SitlProcessStatus) => void;
}

function waitForPoll(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Stop only the processes managed when this action starts; never relaunch here. */
export async function stopManagedSitl(api: ProcessApi, options: StopOptions = {}) {
  const controller = new AbortController();
  const { signal, timeoutMs = 30_000, pollMs = 300, onStatus } = options;
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error(
    "SITL did not finish stopping. Check Logs and Ports & setup before retrying; no replacement was launched."
  )), timeoutMs);
  const read = async () => {
    controller.signal.throwIfAborted();
    const status = await api.list(controller.signal);
    controller.signal.throwIfAborted();
    onStatus?.(status);
    return status;
  };
  try {
    let status = await read();
    const targets = new Set(status.processes);
    for (const pid of targets) {
      if (status.details.find((process) => process.pid === pid)?.status === "stopping") continue;
      try {
        controller.signal.throwIfAborted();
        await api.stop(pid, controller.signal);
      } catch (error) {
        // A process can exit between the list and stop requests.
        status = await read();
        if (status.processes.includes(pid)) throw error;
      }
    }
    status = await read();
    while (status.processes.some((pid) => targets.has(pid))) {
      await waitForPoll(pollMs, controller.signal);
      status = await read();
    }
    if (status.processes.length) {
      throw new Error("Another managed SITL process started during maintenance. Review Ports & setup before retrying; no replacement was launched.");
    }
    return status;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
