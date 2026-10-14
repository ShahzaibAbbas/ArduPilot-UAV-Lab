import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import { managedWslCommand, managedWslLaunch, sitlProcessEnvironment, stopManagedWslSession, wslCommandSupervisorScript, wslStopScript, wslSupervisorScript } from "./wslSession.js";

const run = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixturePlan = {
  source: "wsl", command: "wsl.exe", headless: true,
  args: ["-d", "Ubuntu", "--exec", "bash", "-lc", 'cd "$1" && shift && exec python3 "$@"',
    "uav-lab", "/home/test/ArduPilot checkout", "/home/test/ArduPilot checkout/Tools/autotest/sim_vehicle.py", "--no-rebuild"]
};

test("GUI launches show ArduPilot's terminal instead of leaving only its minimized taskbar icon", () => {
  const inherited = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", SITL_RITW_MINIMIZE: "1",
    TMUX: "other-session", STY: "other-screen", ZELLIJ: "other-pane", SITL_RITW_TERMINAL: "screen -D -m", PATH: "runtime-path" };
  const gui = sitlProcessEnvironment(false, inherited);
  assert.equal(gui.SITL_RITW_MINIMIZE, "0");
  assert.equal(gui.DISPLAY, ":0");
  assert.equal(gui.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(gui.PATH, "runtime-path");
  for (const name of ["TMUX", "STY", "ZELLIJ", "SITL_RITW_TERMINAL"]) assert.equal(gui[name], undefined);
  const headless = sitlProcessEnvironment(true, inherited);
  for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "SITL_RITW_MINIMIZE", "TMUX", "STY", "ZELLIJ", "SITL_RITW_TERMINAL"]) assert.equal(headless[name], undefined);
  assert.equal(inherited.SITL_RITW_MINIMIZE, "1", "Parent environment remains unchanged.");
  assert.match(wslSupervisorScript, /environment\['SITL_RITW_MINIMIZE'\] = '0'/);
});

test("WSL auxiliary commands retain arguments and get isolated cleanup tokens", () => {
  const args = ["-d", "Distro with spaces", "--exec", "bash", "-lc", 'exec "$@"', "uav-lab", "cmake", "--build", "/tmp/build space"];
  const result = managedWslCommand("wsl.exe", args);
  assert.deepEqual(result.args.slice(0, 7), ["-d", "Distro with spaces", "--exec", "python3", "-u", "-c", wslCommandSupervisorScript]);
  assert.deepEqual(result.args.slice(8), args.slice(3));
  assert.equal(result.args[7], result.guestSession.token);
  assert.equal(result.guestSession.distro, "Distro with spaces");
  assert.deepEqual(managedWslCommand("cmake", ["--version"]), { command: "cmake", args: ["--version"] });
  assert.deepEqual(managedWslCommand("wsl.exe", ["--list", "--quiet"]), { command: "wsl.exe", args: ["--list", "--quiet"] });
});

test("native launch remains unchanged and WSL receives a unique managed session", () => {
  const native = { source: "native", command: "python3", args: ["sim_vehicle.py"] };
  assert.deepEqual(managedWslLaunch(native), { command: native.command, args: native.args });
  const launch = managedWslLaunch(fixturePlan);
  assert.equal(launch.command, "wsl.exe");
  assert.equal(launch.guestSession.distro, "Ubuntu");
  assert.match(launch.guestSession.token, /^[0-9a-f-]{36}$/);
  assert.notEqual(launch.guestSession.token, managedWslLaunch(fixturePlan).guestSession.token);
  assert.deepEqual(launch.args.slice(-5), [wslSupervisorScript, launch.guestSession.token,
    fixturePlan.args[8], "1", "--no-rebuild"]);
  assert.equal(launch.args[7], fixturePlan.args[7], "Checkout paths with spaces remain one positional argument.");
  assert.equal(managedWslLaunch({ ...fixturePlan, headless: false }).args.at(-2), "0");
});

test("malformed WSL launchers and cleanup identifiers cannot reach a shell", async () => {
  for (const args of [[], ["-d", "Ubuntu"], fixturePlan.args.with(3, "sh"), fixturePlan.args.with(7, "")]) {
    assert.throws(() => managedWslLaunch({ ...fixturePlan, args }), /launcher is invalid/);
  }
  let called = false;
  const runner = async () => { called = true; };
  assert.equal(await stopManagedWslSession({}, runner), false);
  for (const token of ["../other", "$(touch bad)", "", null]) {
    await assert.rejects(stopManagedWslSession({ uavLabGuestSession: { token, distro: "Ubuntu" } }, runner), /identifier is invalid/);
  }
  assert.equal(called, false);
});

test("cleanup targets the recorded guest token and propagates failure", async () => {
  const token = randomUUID();
  const child = { uavLabGuestSession: { token, distro: "Ubuntu" } };
  let actual;
  assert.equal(await stopManagedWslSession(child, async (...args) => { actual = args; }), true);
  assert.deepEqual(actual[0], "wsl.exe");
  assert.deepEqual(actual[1], ["-d", "Ubuntu", "--exec", "python3", "-c", wslStopScript, token]);
  assert.equal(actual[2].windowsHide, true);
  assert.ok(actual[2].timeout <= 15000);
  await assert.rejects(stopManagedWslSession(child, async () => { throw new Error("guest unavailable"); }), /guest unavailable/);
});

const realWsl = process.platform === "win32" && process.env.UAV_LAB_TEST_WSL === "1";
const distro = process.env.UAV_LAB_TEST_WSL_DISTRO || "Ubuntu";
const fixturePython = String.raw`
import json, os, signal, subprocess, sys, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
descendant = subprocess.Popen([sys.executable, '-u', '-c', 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(90)'], start_new_session=True)
directory = next(arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--use-dir='))
print('FIXTURE ' + json.dumps({'pid': os.getpid(), 'descendant': descendant.pid, 'directory': directory}), flush=True)
time.sleep(90)
`;

async function python(code, args = []) {
  const { stdout } = await run("wsl.exe", ["-d", distro, "--exec", "python3", "-c", code, ...args], {
    windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024
  });
  return stdout.trim();
}

async function fixtureFile() {
  return python("import base64,os,sys,tempfile; f,p=tempfile.mkstemp(prefix='uav-lab-wsl-fixture-', suffix='.py'); os.write(f,base64.b64decode(sys.argv[1])); os.close(f); print(p)",
    [Buffer.from(fixturePython).toString("base64")]);
}

function supervisor(token, file) {
  const child = spawn("wsl.exe", ["-d", distro, "--exec", "python3", "-u", "-c", wslSupervisorScript, token, file, "1"], {
    windowsHide: true, stdio: ["pipe", "pipe", "pipe"]
  });
  child.uavLabGuestSession = { token, distro };
  child.output = "";
  child.stdout.on("data", (data) => { child.output = (child.output + data.toString()).slice(-8000); });
  child.stderr.on("data", (data) => { child.output = (child.output + data.toString()).slice(-8000); });
  child.closed = once(child, "exit");
  return child;
}

async function until(check, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}

async function ready(child) {
  return until(() => {
    const result = child.output.match(/FIXTURE (\{[^\n]+\})/);
    if (result) return JSON.parse(result[1]);
    if (child.exitCode !== null) throw new Error(`Synthetic supervisor exited early: ${child.output}`);
  }, "Synthetic supervisor did not start.");
}

async function runtimeState(token, fixture) {
  return JSON.parse(await python(String.raw`
import json,os,sys,tempfile
token,pids=sys.argv[1],json.loads(sys.argv[2])
alive=[]
for pid in pids:
    try:
        with open('/proc/' + str(pid) + '/stat') as stream:
            if stream.read().rsplit(')',1)[1].split()[0] != 'Z': alive.append(pid)
    except FileNotFoundError: pass
directory=os.path.join(tempfile.gettempdir(),'uav-lab-sitl-' + str(os.getuid()) + '-' + token)
print(json.dumps({'alive':alive,'directoryExists':os.path.exists(directory)}))
`, [token, JSON.stringify(fixture ? [fixture.pid, fixture.descendant] : [])]));
}

async function closeSupervisor(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    await Promise.race([child.closed, delay(12000)]);
    if (child.exitCode === null && child.signalCode === null) {
      await stopManagedWslSession(child, run);
      await Promise.race([child.closed, delay(5000)]);
    }
  }
}

test("WSL cleanup stops only its inherited token, including detached descendants", { skip: !realWsl, timeout: 45000 }, async () => {
  const file = await fixtureFile();
  const token = randomUUID();
  const unrelatedToken = randomUUID();
  let owned;
  let unrelated;
  try {
    owned = supervisor(token, file);
    const ownedFixture = await ready(owned);
    unrelated = supervisor(unrelatedToken, file);
    const unrelatedFixture = await ready(unrelated);
    await stopManagedWslSession(owned, run);
    await owned.closed;
    assert.deepEqual(await runtimeState(token, ownedFixture), { alive: [], directoryExists: false });
    assert.deepEqual((await runtimeState(unrelatedToken, unrelatedFixture)).alive,
      [unrelatedFixture.pid, unrelatedFixture.descendant], "An unrelated session must survive Stop.");
  } finally {
    await closeSupervisor(owned);
    await closeSupervisor(unrelated);
    await python("import os,sys; os.unlink(sys.argv[1])", [file]);
  }
});

test("WSL cancellation before supervisor startup prevents the simulator from starting", { skip: !realWsl, timeout: 30000 }, async () => {
  const file = await fixtureFile();
  const token = randomUUID();
  let child;
  const stopped = stopManagedWslSession({ uavLabGuestSession: { token, distro } }, run);
  // Attach rejection handling immediately while waiting for the durable cancellation marker.
  void stopped.catch(() => undefined);
  try {
    await until(async () => (await runtimeState(token)).directoryExists, "Pre-start cancellation did not create its marker.");
    child = supervisor(token, file);
    await stopped;
    await child.closed;
    assert.doesNotMatch(child.output, /FIXTURE/);
    assert.equal(child.exitCode, 0);
    assert.equal((await runtimeState(token)).directoryExists, false);
  } finally {
    await closeSupervisor(child);
    await python("import os,sys; os.unlink(sys.argv[1])", [file]);
  }
});

test("WSL owner pipe closure cleans descendants and temporary simulator state", { skip: !realWsl, timeout: 30000 }, async () => {
  const file = await fixtureFile();
  const token = randomUUID();
  let child;
  try {
    child = supervisor(token, file);
    const fixture = await ready(child);
    child.stdin.end();
    await until(() => child.exitCode !== null || child.signalCode !== null, "Supervisor did not exit after owner pipe closure.");
    assert.deepEqual(await runtimeState(token, fixture), { alive: [], directoryExists: false });
  } finally {
    await closeSupervisor(child);
    await python("import os,sys; os.unlink(sys.argv[1])", [file]);
  }
});
