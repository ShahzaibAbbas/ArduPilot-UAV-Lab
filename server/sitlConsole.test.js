import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { normalizeSitlConsoleInput, sitlConsoleInputLimit, writeSitlConsoleInput } from "./sitlConsole.js";

test("normalizes bounded MAVProxy input and removes control newlines", () => {
  assert.equal(normalizeSitlConsoleInput("  status\r\n"), "status\n");
  assert.equal(normalizeSitlConsoleInput("mode\nGUIDED"), "mode GUIDED\n");
  assert.throws(() => normalizeSitlConsoleInput("\0"), /cannot be empty/);
  assert.throws(() => normalizeSitlConsoleInput("! whoami"), /Shell escape/);
  assert.throws(() => normalizeSitlConsoleInput("x".repeat(sitlConsoleInputLimit + 1)), /2048/);
  assert.throws(() => normalizeSitlConsoleInput("quit\n\n".repeat(0)), /cannot be empty/);
});

test("writes commands only to a live managed child stdin", () => {
  const stdin = new PassThrough();
  let output = "";
  stdin.on("data", (chunk) => { output += chunk.toString(); });
  const child = { stdin, exitCode: null, signalCode: null };
  assert.deepEqual(writeSitlConsoleInput(child, "status"), { accepted: true, inputLength: 6 });
  assert.equal(output, "status\n");
  assert.throws(() => writeSitlConsoleInput({ ...child, exitCode: 0 }, "status"), /exited/);
  stdin.destroy();
  assert.throws(() => writeSitlConsoleInput(child, "status"), /exited/);
});
