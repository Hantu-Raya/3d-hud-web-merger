import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveHudPayloadConflicts } from "../src/hudConflictResolver.js";
import { decompilePanoramaLayoutResource } from "../src/source2ResourceReader.js";
import { compilePanoramaLayoutResource } from "../src/source2ResourceWriter.js";
import { parseVpk } from "../src/vpkReader.js";
import { writeVpk } from "../src/vpkWriter.js";

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

test("resolveHudPayloadConflicts patches a DATA hud.vxml_c conflict and appends non-conflicting payload files", () => {
  const existingFiles = [
    layoutFile("panorama/layout/hud.vxml_c", baseLayout),
    textFile("panorama/scripts/existing.vjs_c", "existing")
  ];

  const result = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />',
    allowDataLayoutPatching: true
  });

  assert.equal(result.blockedConflicts.length, 0);
  assert.deepEqual(result.patchedPaths, ["panorama/layout/hud.vxml_c"]);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    "panorama/layout/hud.vxml_c",
    "panorama/layout/hud_health.vxml_c",
    "panorama/scripts/3d_hero_dynamic.vjs_c",
    "panorama/scripts/existing.vjs_c",
    "panorama/styles/3d_hud.vcss_c",
    "panorama/styles/citadel_status_effect.vcss_c",
    "panorama/styles/hud_health.vcss_c",
    "panorama/styles/hud_health_container.vcss_c"
  ]);

  const patchedHud = result.files.find((file) => file.path === "panorama/layout/hud.vxml_c");
  const decompiled = decompilePanoramaLayoutResource(patchedHud.bytes).source;
  assert.match(decompiled, /ExistingHud/);
  assert.match(decompiled, /ThreeDHeroHudProbe/);
  assert.doesNotMatch(decompiled, /PayloadReplacement/);

  const reparsed = parseVpk(writeVpk(result.files));
  assert.equal(reparsed.files.length, 8);
});

test("resolveHudPayloadConflicts patches a LaCo hud.vxml_c conflict", () => {
  const lacoHudBytes = new Uint8Array(readFileSync(new URL("../public/payload/3d-hud/panorama/layout/hud.vxml_c", import.meta.url)));
  const existingFiles = [
    { path: "panorama/layout/hud.vxml_c", bytes: lacoHudBytes },
    textFile("panorama/scripts/existing.vjs_c", "existing")
  ];

  const result = resolveHudPayloadConflicts(existingFiles, payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />',
    allowDataLayoutPatching: true
  });

  assert.equal(result.blockedConflicts.length, 0);
  assert.deepEqual(result.patchedPaths, ["panorama/layout/hud.vxml_c"]);

  const patchedHud = result.files.find((file) => file.path === "panorama/layout/hud.vxml_c");
  const decompiled = decompilePanoramaLayoutResource(patchedHud.bytes).source;
  assert.match(decompiled, /ThreeDHeroHudProbe/);
  assert.match(decompiled, /3d_hero_dynamic\.vjs_c/);
  assert.match(
    decompiled,
    /<CitadelHudHeroTesting id="hud_hero_testing" \/>\s*<Panel id="ThreeDHeroHudProbe"/
  );
});

test("resolveHudPayloadConflicts patches hud_health.vxml_c by preserving user scripts and applying payload health body", () => {
  const existingHealth = layoutFile("panorama/layout/hud_health.vxml_c", [
    "<root>",
    "  <styles>",
    "    <include src=\"s2r://panorama/styles/hud_health.vcss_c\" />",
    "  </styles>",
    "  <scripts>",
    "    <include src=\"s2r://panorama/scripts/anita_persist_loader.vjs_c\" />",
    "  </scripts>",
    "  <Panel class=\"bars_container\" hittest=\"false\">",
    "    <Panel class=\"health_bar_line old_health_layout\" />",
    "  </Panel>",
    "</root>"
  ].join("\n"));

  const result = resolveHudPayloadConflicts([existingHealth], payloadFiles, {
    hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />',
    allowDataLayoutPatching: true
  });

  assert.equal(result.blockedConflicts.length, 0);
  assert.deepEqual(result.patchedPaths, ["panorama/layout/hud_health.vxml_c"]);

  const patchedHealth = result.files.find((file) => file.path === "panorama/layout/hud_health.vxml_c");
  const decompiled = decompilePanoramaLayoutResource(patchedHealth.bytes).source;
  assert.match(decompiled, /anita_persist_loader\.vjs_c/);
  assert.match(decompiled, /hp_custom_health_root/);
  assert.match(decompiled, /hp_custom_text/);
  assert.doesNotMatch(decompiled, /old_health_layout/);
  assert.equal(result.files.filter((file) => file.path === "panorama/layout/hud_health.vxml_c").length, 1);
});

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
    { hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />', allowDataLayoutPatching: true }
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

test("resolveHudPayloadConflicts blocks hud.vxml_c when decompile fails", () => {
  const result = resolveHudPayloadConflicts(
    [{ path: "panorama/layout/hud.vxml_c", bytes: encoder.encode("not a source2 resource") }],
    payloadFiles,
    { hudProbeSource: '<Panel id="ThreeDHeroHudProbe" />', allowDataLayoutPatching: true }
  );

  assert.equal(result.files, null);
  assert.equal(result.blockedConflicts.length, 1);
  assert.match(result.blockedConflicts[0].reason, /decompile/i);
});
