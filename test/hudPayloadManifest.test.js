import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { decompilePanoramaLayoutResource } from "../src/source2ResourceReader.js";
import { normalizeVpkPath } from "../src/vpkMerge.js";

const requiredPaths = [
  "panorama/layout/hud.vxml_c",
  "panorama/layout/hud_health_container.vxml_c",
  "panorama/layout/hud_health.vxml_c",
  "panorama/scripts/3d_hero_dynamic.vjs_c",
  "panorama/styles/base/citadel_status_effect.vcss_c",
  "panorama/styles/base/hud_health.vcss_c",
  "panorama/styles/base/hud_health_container.vcss_c",
  "panorama/styles/base/unit_status_icons.vcss_c",
  "panorama/styles/3d_hud.vcss_c",
  "panorama/styles/citadel_status_effect.vcss_c",
  "panorama/styles/hud_health.vcss_c",
  "panorama/styles/hud_health_container.vcss_c",
  "panorama/styles/unit_status_icons.vcss_c"
];

test("3D HUD payload manifest lists unique existing compiled files", async () => {
  const manifestUrl = new URL("../public/payload/3d-hud/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.deepEqual(manifest.files, requiredPaths);
  assert.equal(manifest.sourceRepository, "Hantu-Raya/Deadlock-mods-collection");
  assert.equal(manifest.sourceRef, "main");
  assert.equal(manifest.sourcePath, "3d hud");
  assert.equal(manifest.cssHijackBasePath, "panorama/styles/base/");
  assert.deepEqual(manifest.cssHijackBaseFiles, [
    "panorama/styles/base/citadel_status_effect.vcss_c",
    "panorama/styles/base/hud_health.vcss_c",
    "panorama/styles/base/hud_health_container.vcss_c",
    "panorama/styles/base/unit_status_icons.vcss_c"
  ]);
  assert.equal(manifest.vpkExtractor, "VPKEdit CLI");
  assert.equal(manifest.scriptMinifier, "terser");
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);

  const normalized = manifest.files.map(normalizeVpkPath);
  assert.equal(new Set(normalized).size, normalized.length);

  await Promise.all(manifest.files.map(async (filePath) => {
    const fileUrl = new URL(`../public/payload/3d-hud/${filePath}`, import.meta.url);
    const info = await stat(fileUrl);
    assert.ok(info.isFile(), `${filePath} should be a file`);
    assert.ok(info.size > 0, `${filePath} should not be empty`);
  }));
});

test("hud_health payload temporarily omits anita_persist_loader script include", async () => {
  const fileUrl = new URL("../public/payload/3d-hud/panorama/layout/hud_health.vxml_c", import.meta.url);
  const source = decompilePanoramaLayoutResource(new Uint8Array(await readFile(fileUrl))).source;

  assert.doesNotMatch(source, /s2r:\/\/panorama\/scripts\/anita_persist_loader\.vjs_c/);
  assert.doesNotMatch(source, /<scripts>\s*<\/scripts>/);
});
