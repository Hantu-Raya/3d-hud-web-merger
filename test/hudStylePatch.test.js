import assert from "node:assert/strict";
import test from "node:test";

import { createCssDeltaSource, createCssHijackSource, patchHudStyleSource } from "../src/hudStylePatch.js";

test("createCssDeltaSource keeps only changed declarations from base CSS", () => {
  const base = [
    "#HealthRegenAndTotal {",
    "  width: 380px;",
    "  margin-right: -100px;",
    "}",
    ".unchanged {",
    "  opacity: 1;",
    "}"
  ].join("\n");
  const override = [
    "#HealthRegenAndTotal {",
    "  width: 380px;",
    "  margin-right: 20px;",
    "}",
    ".unchanged {",
    "  opacity: 1;",
    "}",
    ".new_rule {",
    "  visibility: visible;",
    "}"
  ].join("\n");

  const delta = createCssDeltaSource(base, override);

  assert.match(delta, /#HealthRegenAndTotal\s*\{[\s\S]*margin-right:\s*20px;/);
  assert.doesNotMatch(delta, /width:\s*380px/);
  assert.doesNotMatch(delta, /\.unchanged/);
  assert.match(delta, /\.new_rule\s*\{[\s\S]*visibility:\s*visible;/);
});

test("createCssDeltaSource compares nested blocks as whole rules", () => {
  const base = [
    "@keyframes 'pulse' {",
    "  0% { opacity: 0; }",
    "  100% { opacity: 1; }",
    "}"
  ].join("\n");
  const override = [
    "@keyframes 'pulse' {",
    "  0% { opacity: 0; }",
    "  100% { opacity: .8; }",
    "}"
  ].join("\n");

  const delta = createCssDeltaSource(base, override);

  assert.match(delta, /@keyframes 'pulse'/);
  assert.match(delta, /opacity:\s*\.8/);
});

test("createCssHijackSource imports base CSS before pruned overrides", () => {
  const source = createCssHijackSource(
    '@import url("s2r://panorama/styles/base/hud_health_container.vcss_c");',
    "#HealthRegenAndTotal { width: 380px; margin-right: 20px; }",
    "#HealthRegenAndTotal { width: 380px; margin-right: -100px; }"
  );

  assert.match(source, /^@import url/);
  assert.doesNotMatch(source, /width:\s*380px/);
  assert.match(source, /margin-right:\s*20px/);
});

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
