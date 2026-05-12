import assert from "node:assert/strict";
import test from "node:test";

import { resolveHudPayloadConflicts } from "../src/hudConflictResolver.js";
import { compilePanoramaLayoutResource } from "../src/source2ResourceWriter.js";

const encoder = new TextEncoder();

function textFile(path, text) {
  return { path, bytes: encoder.encode(text) };
}

function layoutFile(path, source) {
  return { path, bytes: compilePanoramaLayoutResource(source) };
}

const baseLayout = [
  "<root>",
  "  <styles>",
  "    <include src=\"s2r://panorama/styles/existing.vcss_c\" />",
  "  </styles>",
  "  <CitadelHud>",
  "    <Panel id=\"ExistingHud\" />",
  "  </CitadelHud>",
  "</root>"
].join("\n");

const payloadFiles = [
  layoutFile("panorama/layout/hud.vxml_c", "<root><CitadelHud><Panel id=\"PayloadReplacement\" /></CitadelHud></root>"),
  layoutFile("panorama/layout/hud_health.vxml_c", [
    "<root>",
    "  <styles>",
    "    <include src=\"s2r://panorama/styles/hud_health.vcss_c\" />",
    "  </styles>",
    "  <Panel class=\"bars_container\" hittest=\"false\">",
    "    <Panel class=\"hp_custom_health_root\">",
    "      <Panel id=\"hp_custom_text\" />",
    "    </Panel>",
    "  </Panel>",
    "</root>"
  ].join("\n")),
  textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "script"),
  textFile("panorama/styles/3d_hud.vcss_c", "style"),
  textFile("panorama/styles/hud_health.vcss_c", ".hp_custom_text{visibility: visible;}"),
  textFile("panorama/styles/hud_health_container.vcss_c", "#HealthBarContent{opacity: 1;}"),
  textFile("panorama/styles/citadel_status_effect.vcss_c", "CitadelStatusEffect{height: 250px;}")
];

test("resolveHudPayloadConflicts sends supported vcss conflicts to compiler-backed patching", () => {
  const existingFiles = [
    textFile("panorama/styles/hud_health.vcss_c", ".existing_health{color: red;}")
  ];

  const result = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(result.files, null);
  assert.equal(result.blockedConflicts.length, 1);
  assert.equal(result.blockedConflicts[0].path, "panorama/styles/hud_health.vcss_c");
  assert.match(result.blockedConflicts[0].reason, /compiler-backed patching/i);
});

test("resolveHudPayloadConflicts blocks layout conflicts by default to avoid DATA-only vxml_c output", () => {
  const existingFiles = [
    layoutFile("panorama/layout/hud.vxml_c", baseLayout)
  ];

  const result = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(result.files, null);
  assert.equal(result.blockedConflicts.length, 1);
  assert.equal(result.blockedConflicts[0].path, "panorama/layout/hud.vxml_c");
  assert.match(result.blockedConflicts[0].reason, /compiler-backed layout patching/i);
});

test("resolveHudPayloadConflicts keeps non-hud conflicts blocked", () => {
  const result = resolveHudPayloadConflicts(
    [textFile("panorama/styles/3d_hud.vcss_c", "existing")],
    payloadFiles,
    { hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />' }
  );

  assert.equal(result.files, null);
  assert.equal(result.blockedConflicts.length, 1);
  assert.equal(result.blockedConflicts[0].path, "panorama/styles/3d_hud.vcss_c");
});

test("resolveHudPayloadConflicts keeps byte-identical payload conflicts without blocking reruns", () => {
  const existingFiles = [
    textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "script"),
    textFile("panorama/styles/3d_hud.vcss_c", "style"),
    textFile("panorama/styles/unit_status_icons.vcss_c", "icons"),
    textFile("panorama/scripts/existing.vjs_c", "existing")
  ];
  const payload = [
    textFile("panorama/scripts/3d_hero_dynamic.vjs_c", "script"),
    textFile("panorama/styles/3d_hud.vcss_c", "style"),
    textFile("panorama/styles/unit_status_icons.vcss_c", "icons"),
    textFile("panorama/layout/hud_health_container.vxml_c", "<root />")
  ];

  const result = resolveHudPayloadConflicts(existingFiles, payload, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />'
  });

  assert.equal(result.blockedConflicts.length, 0);
  assert.deepEqual(result.patchedPaths, []);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    "panorama/layout/hud_health_container.vxml_c",
    "panorama/scripts/3d_hero_dynamic.vjs_c",
    "panorama/scripts/existing.vjs_c",
    "panorama/styles/3d_hud.vcss_c",
    "panorama/styles/unit_status_icons.vcss_c"
  ]);
  assert.equal(result.files.filter((file) => file.path === "panorama/scripts/3d_hero_dynamic.vjs_c").length, 1);
});
