import { spawn } from "node:child_process";

const maxOutputBytes = 1024 * 256;

function shellForPlatform(command) {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
    };
  }

  return {
    command: process.env.SHELL || "bash",
    args: ["-lc", command]
  };
}

function appendLimited(current, chunk) {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= maxOutputBytes) {
    return next;
  }
  return next.slice(Math.max(0, next.length - maxOutputBytes));
}

export function runTerminalCommand(command, { cwd, timeoutMs = 60000, env = process.env } = {}) {
  const trimmed = String(command || "").trim();
  if (!trimmed) {
    throw new Error("Command is required.");
  }
  if (trimmed.length > 2000) {
    throw new Error("Command is too long.");
  }

  const shell = shellForPlatform(trimmed);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(shell.command, shell.args, {
      cwd,
      env,
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(process.platform === "win32" ? undefined : "SIGTERM");
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command: trimmed,
        exitCode: 1,
        signal: undefined,
        stdout,
        stderr: appendLimited(stderr, error.message),
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command: trimmed,
        exitCode: timedOut ? 124 : exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });
  });
}
