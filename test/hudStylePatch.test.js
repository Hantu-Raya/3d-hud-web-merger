import assert from "node:assert/strict";
import test from "node:test";

import { patchHudStyleSource } from "../src/hudStylePatch.js";

test("patchHudStyleSource appends 3D HUD CSS without replacing existing CSS", () => {
  const existing = ".existing_rule{color: red;}";
  const payload = ".hp_custom_text{visibility: visible;}";

  const patched = patchHudStyleSource(existing, payload);

  assert.match(patched, /\.existing_rule/);
  assert.match(patched, /\.hp_custom_text/);
  assert.ok(patched.indexOf(".existing_rule") < patched.indexOf(".hp_custom_text"));
});

test("patchHudStyleSource is idempotent", () => {
  const existing = ".existing_rule{color: red;}";
  const payload = ".hp_custom_text{visibility: visible;}";

  const once = patchHudStyleSource(existing, payload);
  const twice = patchHudStyleSource(once, payload);

  assert.equal(twice.match(/hp_custom_text/g).length, 1);
});

test("patchHudStyleSource rejects empty payload CSS", () => {
  assert.throws(
    () => patchHudStyleSource(".existing_rule{}", ""),
    /payload CSS/i
  );
});
