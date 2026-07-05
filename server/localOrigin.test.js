import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedLocalOrigin } from "./localOrigin.js";

test("allows requests without an origin header", () => {
  assert.equal(isAllowedLocalOrigin(undefined), true);
  assert.equal(isAllowedLocalOrigin(""), true);
});

test("allows local http and https browser origins", () => {
  assert.equal(isAllowedLocalOrigin("http://localhost:5173"), true);
  assert.equal(isAllowedLocalOrigin("https://127.0.0.1:4310"), true);
  assert.equal(isAllowedLocalOrigin("http://[::1]:4310"), true);
});

test("rejects non-local or non-browser origins", () => {
  assert.equal(isAllowedLocalOrigin("http://example.com"), false);
  assert.equal(isAllowedLocalOrigin("https://192.168.1.4:4310"), false);
  assert.equal(isAllowedLocalOrigin("file:///tmp/index.html"), false);
  assert.equal(isAllowedLocalOrigin("not a url"), false);
});
