import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MISSION_FILE_BYTES, MAX_MISSION_ITEMS, missionDistanceKm, parseMissionText } from "./missionFiles.js";

const row = ({ seq = 0, frame = 3, command = 16, x = 33.5, y = 73.25, z = 40 } = {}) =>
  `${seq}\t${seq === 0 ? 1 : 0}\t${frame}\t${command}\t0\t0\t0\t0\t${x}\t${y}\t${z}\t1`;
const file = (...rows) => `QGC WPL 110\n${rows.join("\n")}\n`;

test("mission imports require a single header and every complete, consecutive row", () => {
  assert.equal(parseMissionText(`\uFEFF# exported route\r\n${file(row({ seq: 1 }), row())}`).length, 2);
  for (const content of ["", "# comment", row(), `QGC WPL 120\n${row()}`, file(row(), "QGC WPL 110"),
    file(row(), "invalid row"), file(row({ seq: 1 })), file(row(), row()), file(row().split("\t").slice(0, -1).join("\t"))]) {
    assert.throws(() => parseMissionText(content), /Mission/);
  }
  assert.deepEqual(parseMissionText(file()), []);
});

test("mission imports reject nonfinite values, invalid global coordinates and lossy free integer parameters", () => {
  for (const options of [{ x: 91 }, { y: -181 }, { z: "NaN" }, { z: 1e100 },
    { frame: 22 }, { command: 65536 }, { frame: 2, x: 1.25 }, { seq: MAX_MISSION_ITEMS }]) {
    assert.throws(() => parseMissionText(file(row(options))), /out-of-range/);
  }
  const [local] = parseMissionText(file(row({ frame: 1, x: 5.25, y: -4.5 })));
  assert.equal(local.x, 52500);
  assert.equal(local.y, -45000);
  assert.equal(parseMissionText(file(row({ frame: 2, x: 17, y: 42 })))[0].x, 17);
});

test("mission file bounds count UTF-8 bytes and limit mission item retention", () => {
  assert.throws(() => parseMissionText(`QGC WPL 110\n#${"é".repeat(MAX_MISSION_FILE_BYTES / 2)}`), /2 MiB/);
  assert.throws(() => parseMissionText(file(...Array.from({ length: MAX_MISSION_ITEMS + 1 }, (_, seq) => row({ seq })))), /out-of-range|at most/);
  assert.equal(parseMissionText(file(...Array.from({ length: MAX_MISSION_ITEMS }, (_, seq) => row({ seq })))).length, MAX_MISSION_ITEMS);
});

test("route estimates use ordered global coordinates and accept stationary or empty missions", () => {
  const distance = missionDistanceKm(parseMissionText(file(row({ seq: 1, x: 1, y: 0 }), row({ x: 0, y: 0 }))));
  assert.ok(Math.abs(distance - 111.195) < 0.01);
  assert.equal(missionDistanceKm(parseMissionText(file(row(), row({ seq: 1 })))), 0);
  assert.equal(missionDistanceKm(parseMissionText(file(row()))), 0);
  assert.equal(missionDistanceKm(parseMissionText(file())), 0);
  assert.equal(missionDistanceKm(parseMissionText(file(row({ frame: 1 })))), null);
});

test("route estimates ignore non-positional commands and remain finite across the dateline and antipodes", () => {
  const distance = missionDistanceKm(parseMissionText(file(row({ x: 0, y: 179 }),
    row({ seq: 1, frame: 2, command: 178, x: 0, y: 0 }), row({ seq: 2, command: 21, x: 0, y: -179 }))));
  assert.ok(Math.abs(distance - 222.39) < 0.01);
  assert.ok(Number.isFinite(missionDistanceKm(parseMissionText(file(row({ x: -89.9, y: -179.9 }), row({ seq: 1, x: 89.9, y: 0.1 }))))));
});
