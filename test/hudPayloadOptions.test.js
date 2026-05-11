import assert from "node:assert/strict";
import test from "node:test";

import {
  patchHudHealthContainerStyleSource,
  patchHudScaleStyleSource,
  patchStatusEffectStyleSource,
  normalizeHudUiScale,
  requiresCompilerForHudUiScale
} from "../src/hudPayloadOptions.js";
import {
  createCssHijackSource,
  patchHudStyleSource
} from "../src/hudStylePatch.js";

test("normalizes HUD UI scale to the supported slider range", () => {
  assert.equal(normalizeHudUiScale(110), 120);
  assert.equal(normalizeHudUiScale(145.4), 145);
  assert.equal(normalizeHudUiScale(999), 170);
  assert.equal(normalizeHudUiScale("bad"), 170);
});

test("detects when HUD UI scale needs real compiler output", () => {
  assert.equal(requiresCompilerForHudUiScale(170), false);
  assert.equal(requiresCompilerForHudUiScale(120), true);
});

test("patches the HUD scale source at the 170 target position", () => {
  const source = patchHudScaleStyleSource([
    "#health_and_abilities_container {",
    "  ui-scale: 130%;",
    "}",
    "",
    ".AspectRatio16x10 #health_and_abilities_container {",
    "  margin-right: 10px;",
    "}"
  ].join("\n"), 170);

  assert.match(source, /#health_and_abilities_container\s*\{[\s\S]*ui-scale:\s*170%;/);
  assert.match(source, /#health_and_abilities_container\s*\{[\s\S]*width:\s*350px;/);
  assert.match(source, /\.AspectRatio16x10\s+#health_and_abilities_container\s*\{[\s\S]*margin-right:\s*1030px;/);
  assert.match(source, /\.AspectRatio16x10\s+#health_and_abilities_container\s*\{[\s\S]*margin-left:\s*130px;/);
  assert.match(source, /\.AspectRatio16x10\s+#health_and_abilities_container\s*\{[\s\S]*margin-bottom:\s*-130px;/);
});

test("scales health container margins from the 170 target position", () => {
  const source = patchHudScaleStyleSource("", 120);

  assert.match(source, /ui-scale:\s*120%;/);
  assert.match(source, /margin-right:\s*727px;/);
  assert.match(source, /margin-left:\s*92px;/);
  assert.match(source, /margin-bottom:\s*-92px;/);
});

test("patches status and health container source positioning", () => {
  const statusSource = patchStatusEffectStyleSource([
    "CitadelHud CitadelStatusEffect {",
    "  margin-left: 50px;",
    "}"
  ].join("\n"));
  assert.match(statusSource, /CitadelHud\s+CitadelStatusEffect\s*\{[\s\S]*margin-left:\s*0px;/);

  const healthContainerSource = patchHudHealthContainerStyleSource([
    "#HealthRegenAndTotal {",
    "  margin-right: 0px;",
    "}",
    "",
    "#RecentHealContainer,",
    ".recentHealCounters {",
    "  horizontal-align: right;",
    "  height: 46px;",
    "}",
    "",
    "#RecentDamageContainer,",
    ".recentDamageCounters {",
    "  horizontal-align: right;",
    "  height: 46px;",
    "}"
  ].join("\n"));
  assert.match(healthContainerSource, /#HealthRegenAndTotal\s*\{[\s\S]*margin-right:\s*20px;/);
  assert.match(healthContainerSource, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*horizontal-align:\s*middle;/);
  assert.match(healthContainerSource, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*margin-right:\s*86px;/);
  assert.match(healthContainerSource, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*margin-top:\s*-36px;/);
  assert.match(healthContainerSource, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*height:\s*96px;/);
  assert.match(healthContainerSource, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*horizontal-align:\s*middle;/);
  assert.match(healthContainerSource, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-right:\s*-158px;/);
  assert.match(healthContainerSource, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-top:\s*-36px;/);
  assert.match(healthContainerSource, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*height:\s*96px;/);
});

test("scales health regen position from the 170 target position", () => {
  const source = patchHudHealthContainerStyleSource([
    "#HealthRegenAndTotal {",
    "  margin-right: 20px;",
    "}"
  ].join("\n"), 120);

  assert.match(source, /#HealthRegenAndTotal\s*\{[\s\S]*margin-right:\s*14px;/);
  assert.match(source, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-top:\s*-25px;/);
});

test("patches minified health container CSS without duplicate declarations", () => {
  const source = patchHudHealthContainerStyleSource([
    "#HealthRegenAndTotal{width:380px;margin-right:-100px;overflow:noclip;}",
    "#RecentHealContainer,.recentHealCounters{horizontal-align:right;height:46px;}",
    "#RecentDamageContainer,.recentDamageCounters{horizontal-align:right;height:46px;}"
  ].join(""));

  const regenBlock = source.match(/#HealthRegenAndTotal\s*\{[\s\S]*?\}/)?.[0] || "";
  const healBlock = source.match(/#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*?\}/)?.[0] || "";
  const damageBlock = source.match(/#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*?\}/)?.[0] || "";

  assert.equal(regenBlock.match(/margin-right:/g)?.length, 1);
  assert.equal(healBlock.match(/height:/g)?.length, 1);
  assert.equal(damageBlock.match(/height:/g)?.length, 1);
  assert.match(regenBlock, /margin-right:\s*20px;/);
  assert.match(healBlock, /horizontal-align:\s*middle;/);
  assert.match(healBlock, /margin-right:\s*86px;/);
  assert.match(healBlock, /margin-top:\s*-36px;/);
  assert.match(healBlock, /height:\s*96px;/);
  assert.match(damageBlock, /horizontal-align:\s*middle;/);
  assert.match(damageBlock, /margin-right:\s*-158px;/);
  assert.match(damageBlock, /margin-top:\s*-36px;/);
  assert.match(damageBlock, /height:\s*96px;/);
});

test("creates CSS hijack source with base import before overrides", () => {
  const source = createCssHijackSource(
    '@import url("s2r://panorama/styles/base/hud_health_container.vcss_c");',
    "#HealthRegenAndTotal { margin-right: -100px; }"
  );

  assert.match(source, /^@import url\("s2r:\/\/panorama\/styles\/base\/hud_health_container\.vcss_c"\);/);
  assert.match(source, /#HealthRegenAndTotal\s*\{/);
});

test("patches CSS conflicts while keeping imports hoisted and unique", () => {
  const source = patchHudStyleSource(
    [
      ".userRule { opacity: 1; }",
      '@import url("s2r://panorama/styles/base/hud_health_container.vcss_c");'
    ].join("\n"),
    [
      '@import url("s2r://panorama/styles/base/hud_health_container.vcss_c");',
      ".threeDRule { visibility: visible; }"
    ].join("\n")
  );

  assert.match(source, /^@import url\("s2r:\/\/panorama\/styles\/base\/hud_health_container\.vcss_c"\);\n\n\.userRule/);
  assert.equal(source.match(/base\/hud_health_container\.vcss_c/g).length, 1);
  assert.match(source, /\.threeDRule/);
});
