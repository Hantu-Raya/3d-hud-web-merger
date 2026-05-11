import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompilerBackedHudMergePlan,
  finalizeCompilerBackedHudMerge
} from "../src/compilerBackedMerge.js";
import { resolveHudPayloadConflicts } from "../src/hudConflictResolver.js";
import { compilePanoramaLayoutResource, compileTextResource } from "../src/source2ResourceWriter.js";

const encoder = new TextEncoder();

function textFile(path, text) {
  return { path, bytes: encoder.encode(text) };
}

function compiledStyle(path, text) {
  return { path, bytes: compileTextResource(text) };
}

function layoutFile(path, source) {
  return { path, bytes: compilePanoramaLayoutResource(source) };
}

const baseHud = [
  "<root>",
  "  <styles>",
  "    <include src=\"s2r://panorama/styles/existing.vcss_c\" />",
  "  </styles>",
  "  <CitadelHud>",
  "    <CitadelHudHeroTesting id=\"hud_hero_testing\" />",
  "    <Panel id=\"ExistingHud\" />",
  "  </CitadelHud>",
  "</root>"
].join("\n");

const baseHealth = [
  "<root>",
  "  <Panel class=\"bars_container\">",
  "    <Panel class=\"old_health_layout\" />",
  "  </Panel>",
  "</root>"
].join("\n");

const payloadFiles = [
  layoutFile("panorama/layout/hud.vxml_c", "<root><CitadelHud><Panel id=\"PayloadHud\" /></CitadelHud></root>"),
  layoutFile("panorama/layout/hud_health.vxml_c", [
    "<root>",
    "  <Panel class=\"bars_container\">",
    "    <Panel class=\"hp_custom_health_root\">",
    "      <Panel id=\"hp_custom_text\" />",
    "    </Panel>",
    "  </Panel>",
    "</root>"
  ].join("\n")),
  layoutFile("panorama/layout/hud_health_container.vxml_c", "<root><Panel id=\"PayloadContainer\" /></root>"),
  textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "script"),
  compiledStyle("panorama/styles/3d_hud.vcss_c", ".three-d{visibility: visible;}"),
  compiledStyle("panorama/styles/base/hud_health_container.vcss_c", ".base_health{opacity: 1;}"),
  compiledStyle("panorama/styles/hud_health.vcss_c", ".hp_custom_text{visibility: visible;}"),
  compiledStyle("panorama/styles/hud_health_container.vcss_c", "#HealthBarContent{opacity: 1;}"),
  compiledStyle("panorama/styles/citadel_status_effect.vcss_c", "CitadelStatusEffect{height: 250px;}"),
  compiledStyle("panorama/styles/unit_status_icons.vcss_c", ".unit_status{opacity: 1;}")
];

test("compiler-backed plan makes default-blocked HUD layouts patchable without DATA output", () => {
  const existingFiles = [
    layoutFile("panorama/layout/hud.vxml_c", baseHud),
    layoutFile("panorama/layout/hud_health.vxml_c", baseHealth),
    textFile("panorama/scripts/user_feature.vjs_c", "user")
  ];

  const defaultPlan = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });
  assert.equal(defaultPlan.files, null);
  assert.equal(defaultPlan.blockedConflicts.length, 2);

  const compilerPlan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(compilerPlan.blockedConflicts.length, 0);
  assert.deepEqual(compilerPlan.patchedPaths, [
    "panorama/layout/hud.vxml_c",
    "panorama/layout/hud_health.vxml_c"
  ]);
  assert.deepEqual(compilerPlan.sourcePatches.map((patch) => patch.sourcePath), [
    "panorama/layout/hud.xml",
    "panorama/layout/hud_health.xml"
  ]);
  assert.match(compilerPlan.sourcePatches[0].source, /ThreeDHeroHudProbe/);
  assert.match(
    compilerPlan.sourcePatches[0].source,
    /<CitadelHudHeroTesting id="hud_hero_testing" \/>\s*<Panel id="ThreeDHeroHudProbe"/
  );
  assert.match(compilerPlan.sourcePatches[1].source, /hp_custom_health_root/);
  assert.doesNotMatch(compilerPlan.sourcePatches[1].source, /old_health_layout/);
});

test("compiler-backed plan keeps existing health container layout instead of blocking", () => {
  const existingFiles = [
    layoutFile("panorama/layout/hud_health_container.vxml_c", "<root><Panel id=\"UserContainer\" /></root>")
  ];

  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(plan.blockedConflicts.length, 0);
  assert.equal(plan.sourcePatches.length, 0);
  assert.equal(plan.patchedPaths.length, 0);
  assert.equal(plan.files.filter((file) => file.path === "panorama/layout/hud_health_container.vxml_c").length, 1);
  assert.deepEqual(
    plan.conflicts.map((conflict) => [conflict.path, conflict.resolution]),
    [["panorama/layout/hud_health_container.vxml_c", "Keep existing layout"]]
  );
});

test("compiler-backed plan patches supported CSS conflicts as source for the real compiler", () => {
  const existingFiles = [
    compiledStyle("panorama/styles/3d_hud.vcss_c", ".existing_three_d{opacity: .5;}"),
    compiledStyle("panorama/styles/unit_status_icons.vcss_c", ".existing_icons{opacity: .5;}")
  ];

  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(plan.blockedConflicts.length, 0);
  assert.deepEqual(plan.sourcePatches.map((patch) => patch.sourcePath), [
    "panorama/styles/3d_hud.css",
    "panorama/styles/unit_status_icons.css"
  ]);
  assert.match(plan.sourcePatches[0].source, /\.existing_three_d/);
  assert.match(plan.sourcePatches[0].source, /\.three-d/);
  assert.match(plan.sourcePatches[1].source, /\.existing_icons/);
  assert.match(plan.sourcePatches[1].source, /\.unit_status/);
});

test("compiler-backed plan enforces required health container positioning on CSS conflicts", () => {
  const existingFiles = [
    compiledStyle("panorama/styles/hud_health_container.vcss_c", [
      "#HealthRegenAndTotal{",
      "  margin-right: -100px;",
      "}",
      "#RecentHealContainer,.recentHealCounters{",
      "  horizontal-align: right;",
      "  height: 46px;",
      "}",
      "#RecentDamageContainer,.recentDamageCounters{",
      "  horizontal-align: right;",
      "  height: 46px;",
      "}"
    ].join("\n"))
  ];

  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />',
    hudUiScale: 170
  });

  const patch = plan.sourcePatches.find((entry) => entry.sourcePath === "panorama/styles/hud_health_container.css");
  assert.equal(plan.blockedConflicts.length, 0);
  assert.ok(patch);
  assert.match(patch.source, /#HealthRegenAndTotal\s*\{[\s\S]*margin-right:\s*20px;/);
  assert.match(patch.source, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*horizontal-align:\s*middle;/);
  assert.match(patch.source, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*margin-right:\s*86px;/);
  assert.match(patch.source, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*margin-top:\s*-36px;/);
  assert.match(patch.source, /#RecentHealContainer\s*,\s*\.recentHealCounters\s*\{[\s\S]*height:\s*96px;/);
  assert.match(patch.source, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*horizontal-align:\s*middle;/);
  assert.match(patch.source, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-right:\s*-158px;/);
  assert.match(patch.source, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-top:\s*-36px;/);
  assert.match(patch.source, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*height:\s*96px;/);
});

test("compiler-backed plan reuses existing CSS hijack base files", () => {
  const existingFiles = [
    compiledStyle("panorama/styles/base/hud_health_container.vcss_c", ".user_base{opacity: 1;}")
  ];

  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(plan.blockedConflicts.length, 0);
  assert.equal(plan.files.filter((file) => file.path === "panorama/styles/base/hud_health_container.vcss_c").length, 1);
  assert.equal(
    plan.conflicts.find((conflict) => conflict.path === "panorama/styles/base/hud_health_container.vcss_c")?.resolution,
    "Reuse existing base CSS"
  );
});

test("compiler-backed plan updates existing 3D HUD runtime script", () => {
  const existingFiles = [
    textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "old script")
  ];

  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  const script = plan.files.find((file) => file.path === "panorama/scripts/3d_hero_dynamic.vjs_c");
  assert.equal(plan.blockedConflicts.length, 0);
  assert.deepEqual([...script.bytes], [...encoder.encode("script")]);
  assert.equal(
    plan.conflicts.find((conflict) => conflict.path === "panorama/scripts/3d_hero_dynamic.vjs_c")?.resolution,
    "Update 3D HUD script"
  );
});

test("browser plan reuses existing CSS hijack base files", () => {
  const existingFiles = [
    compiledStyle("panorama/styles/base/hud_health_container.vcss_c", ".user_base{opacity: 1;}"),
    textFile("panorama/scripts/user_feature.vjs_c", "user")
  ];

  const plan = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(plan.blockedConflicts.length, 0);
  assert.equal(plan.files.filter((file) => file.path === "panorama/styles/base/hud_health_container.vcss_c").length, 1);
  assert.equal(
    plan.conflicts.find((conflict) => conflict.path === "panorama/styles/base/hud_health_container.vcss_c")?.resolution,
    "Reuse existing base CSS"
  );
});

test("browser plan updates existing 3D HUD runtime script", () => {
  const existingFiles = [
    textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "old script")
  ];

  const plan = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  const script = plan.files.find((file) => file.path === "panorama/scripts/3d_hero_dynamic.vjs_c");
  assert.equal(plan.blockedConflicts.length, 0);
  assert.deepEqual([...script.bytes], [...encoder.encode("script")]);
  assert.equal(
    plan.conflicts.find((conflict) => conflict.path === "panorama/scripts/3d_hero_dynamic.vjs_c")?.resolution,
    "Update 3D HUD script"
  );
});

test("finalizeCompilerBackedHudMerge replaces patched paths with compiled outputs", () => {
  const existingFiles = [layoutFile("panorama/layout/hud.vxml_c", baseHud)];
  const plan = createCompilerBackedHudMergePlan(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });
  const compiledBytes = encoder.encode("real compiler output");

  const files = finalizeCompilerBackedHudMerge(plan, [
    { path: "panorama/layout/hud.vxml_c", bytes: compiledBytes }
  ]);

  const patchedHud = files.find((file) => file.path === "panorama/layout/hud.vxml_c");
  assert.deepEqual([...patchedHud.bytes], [...compiledBytes]);
  assert.equal(files.filter((file) => file.path === "panorama/layout/hud.vxml_c").length, 1);
});
