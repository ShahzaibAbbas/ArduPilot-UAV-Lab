import { randomUUID } from "node:crypto";

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sitlProcessEnvironment(headless, inherited = process.env) {
  const environment = { ...inherited, PYTHONUNBUFFERED: "1" };
  // Managed launches must not send their vehicle into another terminal server.
  for (const name of ["TMUX", "STY", "ZELLIJ", "SITL_RITW_TERMINAL"]) delete environment[name];
  if (headless) {
    for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "SITL_RITW_MINIMIZE"]) delete environment[name];
  } else {
    // ArduPilot otherwise defaults xterm to -iconic: a taskbar icon only.
    environment.SITL_RITW_MINIMIZE = "0";
  }
  return environment;
}

// Match an inherited token and owner, never an executable name or a reused PID alone.
const processHelpers = String.raw`
import os, signal, time, stat, tempfile, uuid

def control_path(token):
    parsed = uuid.UUID(token)
    if parsed.version != 4 or str(parsed) != token.lower():
        raise ValueError('Invalid managed session token')
    return os.path.join(tempfile.gettempdir(), 'uav-lab-sitl-' + str(os.getuid()) + '-' + token.lower())

def prepare_control(token):
    directory = control_path(token)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    info = os.lstat(directory)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Managed session control directory is not private')
    return directory

def lock_control(directory):
    import fcntl
    fd = os.open(os.path.join(directory, 'control.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    stream = os.fdopen(fd, 'r+')
    fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
    return stream
def owned_processes(token):
    marker = b'UAV_LAB_SITL_SESSION=' + token.encode()
    owned = []
    for item in os.listdir('/proc'):
        if not item.isdigit():
            continue
        pid = int(item)
        try:
            if os.stat('/proc/' + item).st_uid != os.getuid():
                continue
            with open('/proc/' + item + '/environ', 'rb') as stream:
                if marker not in stream.read().split(b'\0'):
                    continue
            with open('/proc/' + item + '/stat') as stream:
                if stream.read().rsplit(')', 1)[1].split()[0] == 'Z':
                    continue
            owned.append(pid)
        except (OSError, IndexError):
            continue
    return owned

def stop_owned(token):
    for sig, duration in [(signal.SIGTERM, 2.0), (signal.SIGKILL, 2.0)]:
        deadline = time.monotonic() + duration
        while True:
            owned = owned_processes(token)
            if not owned:
                return
            for pid in owned:
                try:
                    if pid in owned_processes(token):
                        os.kill(pid, sig)
                except ProcessLookupError:
                    pass
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
    if owned_processes(token):
        raise RuntimeError('A managed WSL simulator process could not be stopped')
`;

export const wslSupervisorScript = processHelpers + String.raw`
import shutil, subprocess, sys, threading
token, script, headless = sys.argv[1:4]
environment = os.environ.copy()
environment['UAV_LAB_SITL_SESSION'] = token
environment['PYTHONUNBUFFERED'] = '1'
for name in ['TMUX', 'STY', 'ZELLIJ', 'SITL_RITW_TERMINAL']:
    environment.pop(name, None)
if headless == '1':
    for name in ['DISPLAY', 'WAYLAND_DISPLAY', 'SITL_RITW_MINIMIZE']:
        environment.pop(name, None)
else:
    # run_in_terminal_window.sh defaults to minimized xterm unless overridden.
    environment['SITL_RITW_MINIMIZE'] = '0'
directory = prepare_control(token)
child = None
input_closed = threading.Event()

def watch_owner_input():
    try:
        # Use the raw descriptor so a blocked daemon cannot hold Python's buffered
        # stdin lock during interpreter shutdown after an immediate cancellation.
        # Forward command bytes to sim_vehicle/MAVProxy as well as watching for
        # EOF.  Previously this watcher discarded every byte, which meant a
        # managed WSL launch could never expose the MAVProxy command prompt.
        while True:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                break
            while child is None and not input_closed.is_set():
                time.sleep(0.01)
            if child is not None and child.stdin is not None:
                try:
                    child.stdin.write(data)
                    child.stdin.flush()
                except (BrokenPipeError, OSError):
                    break
    except OSError:
        pass
    finally:
        input_closed.set()
def interrupted(_signal, _frame):
    raise KeyboardInterrupt()
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
code = 1
try:
    # The API owns this pipe. EOF also cleans up after an abruptly terminated host API.
    threading.Thread(target=watch_owner_input, daemon=True).start()
    with lock_control(directory):
        if not os.path.exists(os.path.join(directory, 'stop')) and not input_closed.is_set():
            runtime_directory = os.path.join(directory, 'runtime')
            os.mkdir(runtime_directory)
            child = subprocess.Popen([sys.executable, '-u', script, *sys.argv[4:], '--use-dir=' + runtime_directory],
                                     env=environment, start_new_session=True, stdin=subprocess.PIPE)
    if child is None:
        code = 0
    else:
        print('UAV Lab: isolated WSL simulator session started', flush=True)
        while not input_closed.is_set():
            try:
                code = child.wait(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                pass
except KeyboardInterrupt:
    code = 0
finally:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    if child is not None and child.stdin is not None:
        child.stdin.close()
    stop_owned(token)
    if child is not None:
        child.wait(timeout=5)
    shutil.rmtree(directory)
sys.exit(code)
`;

export const wslStopScript = processHelpers + String.raw`
import sys
token = sys.argv[1]
directory = prepare_control(token)
try:
    with lock_control(directory):
        # Persist cancellation even when Stop reaches WSL before the launch supervisor.
        with open(os.path.join(directory, 'stop'), 'w'):
            pass
except FileNotFoundError:
    # The supervisor may have completed cleanup while the stop request acquired its lock.
    if os.path.exists(directory):
        raise
stop_owned(token)
deadline = time.monotonic() + 10
while os.path.exists(directory):
    if time.monotonic() >= deadline:
        raise RuntimeError('WSL supervisor did not acknowledge Stop; retry Stop')
    time.sleep(0.1)
`;

export function managedWslLaunch(plan) {
  if (plan.source !== "wsl") return { command: plan.command, args: plan.args };
  // launcherFor keeps the checkout and script as positional arguments after Bash's login command.
  const [flag, distro, exec, bash, login, , label, root, script, ...simulatorArgs] = plan.args;
  if (flag !== "-d" || !distro || exec !== "--exec" || bash !== "bash" || login !== "-lc" || !root || !script) {
    throw new Error("The detected WSL launcher is invalid. Run Auto-detect again.");
  }
  const token = randomUUID();
  return {
    command: "wsl.exe",
    args: ["-d", distro, "--exec", "bash", "-lc", 'cd "$1" && shift && exec python3 -u -c "$@"',
      label, root, wslSupervisorScript, token, script, plan.headless === false ? "0" : "1", ...simulatorArgs],
    guestSession: { distro, token }
  };
}

// Build and diagnostic commands need the same ownership guarantees as SITL,
// without SITL-specific arguments or a separate working directory.
export const wslCommandSupervisorScript = processHelpers + String.raw`
import shutil, subprocess, sys, threading
token = sys.argv[1]
environment = os.environ.copy()
environment['UAV_LAB_SITL_SESSION'] = token
directory = prepare_control(token)
input_closed = threading.Event()
child = None
def watch_owner_input():
    try:
        while os.read(sys.stdin.fileno(), 1):
            pass
    except OSError:
        pass
    finally:
        input_closed.set()
def interrupted(_signal, _frame):
    raise KeyboardInterrupt()
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
code = 1
try:
    threading.Thread(target=watch_owner_input, daemon=True).start()
    with lock_control(directory):
        if not os.path.exists(os.path.join(directory, 'stop')) and not input_closed.is_set():
            child = subprocess.Popen(sys.argv[2:], env=environment, start_new_session=True, stdin=subprocess.DEVNULL)
    if child is None:
        code = 0
    else:
        while not input_closed.is_set():
            try:
                code = child.wait(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                pass
except KeyboardInterrupt:
    code = 0
finally:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    stop_owned(token)
    if child is not None:
        child.wait(timeout=5)
    shutil.rmtree(directory)
sys.exit(code)
`;

export function managedWslCommand(command, args) {
  const distroIndex = args.indexOf("-d");
  const execIndex = args.indexOf("--exec");
  if (!/(?:^|[\\/])wsl(?:\.exe)?$/i.test(command) || distroIndex < 0 || execIndex < 0) return { command, args };
  const distro = args[distroIndex + 1];
  if (!distro || !args[execIndex + 1]) throw new Error("The managed WSL command is invalid.");
  const token = randomUUID();
  return {
    command,
    args: [...args.slice(0, execIndex + 1), "python3", "-u", "-c", wslCommandSupervisorScript, token, ...args.slice(execIndex + 1)],
    guestSession: { distro, token }
  };
}

export async function stopManagedWslSession(child, run) {
  const session = child.uavLabGuestSession;
  if (!session) return false;
  if (!sessionPattern.test(session.token) || typeof session.distro !== "string" || !session.distro) {
    throw new Error("The managed WSL session identifier is invalid.");
  }
  await run("wsl.exe", ["-d", session.distro, "--exec", "python3", "-c", wslStopScript, session.token], {
    windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024
  });
  return true;
}
