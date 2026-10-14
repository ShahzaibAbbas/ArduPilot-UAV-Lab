/**
 * Helpers for the managed SITL/MAVProxy command channel.
 *
 * sim_vehicle.py starts MAVProxy as a child and inherits the launcher's stdin.
 * Keeping this channel behind a small, bounded helper lets the browser provide
 * an embedded command console without exposing a general shell or writing to
 * arbitrary processes.
 */
const MAX_INPUT_LENGTH = 2048;

export function normalizeSitlConsoleInput(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Console input must be text."), { statusCode: 400 });
  }
  const input = value.replace(/\0/g, "").replace(/[\r\n]+/g, " ").trim();
  if (!input) {
    throw Object.assign(new Error("Console input cannot be empty."), { statusCode: 400 });
  }
  // MAVProxy's leading ! command escapes to a host shell. Keep this browser
  // channel limited to MAVLink/MAVProxy commands and leave shell work to the
  // separately protected terminal tool.
  if (input.startsWith("!")) {
    throw Object.assign(new Error("Shell escape commands are disabled in the MAVProxy console."), { statusCode: 400 });
  }
  if (input.length > MAX_INPUT_LENGTH) {
    throw Object.assign(new Error(`Console input must be ${MAX_INPUT_LENGTH} characters or fewer.`), { statusCode: 400 });
  }
  return `${input}\n`;
}

/** Write one MAVProxy command to a managed child's inherited stdin. */
export function writeSitlConsoleInput(child, value) {
  const input = normalizeSitlConsoleInput(value);
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    throw Object.assign(new Error("The SITL console is unavailable because the process has exited."), { statusCode: 409 });
  }
  try {
    child.stdin.write(input);
  } catch (error) {
    throw Object.assign(new Error("The SITL console could not accept the command."), { statusCode: 409, cause: error });
  }
  return { accepted: true, inputLength: input.length - 1 };
}

export const sitlConsoleInputLimit = MAX_INPUT_LENGTH;
