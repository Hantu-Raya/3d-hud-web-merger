import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { decompilePanoramaLayoutResource } from "../src/source2ResourceReader.js";
import { decompileTextResource } from "../src/source2TextResource.js";
import { normalizeVpkPath } from "../src/vpkMerge.js";
import {
  DEFAULT_HUD_UI_SCALE,
  HUD_UI_SCALE_PATCHED_PATHS,
  MAX_HUD_UI_SCALE,
  MIN_HUD_UI_SCALE
} from "../src/hudPayloadOptions.js";

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
  assert.equal(manifest.scriptSourcePath, "3d hud/panorama/scripts/3d_hero_dynamic.js");
  assert.equal(manifest.scriptCompiledPath, "panorama/scripts/3d_hero_dynamic.vjs_c");
  assert.equal(manifest.cssHijackBasePath, "panorama/styles/base/");
  assert.deepEqual(manifest.cssHijackBaseFiles, [
    "panorama/styles/base/citadel_status_effect.vcss_c",
    "panorama/styles/base/hud_health.vcss_c",
    "panorama/styles/base/hud_health_container.vcss_c",
    "panorama/styles/base/unit_status_icons.vcss_c"
  ]);
  assert.equal(manifest.baseSourceRepository, "SteamTracking/GameTracking-Deadlock");
  assert.equal(manifest.baseSourceRef, "master");
  assert.equal(manifest.baseSourcePath, "game/citadel/pak01_dir/panorama/styles");
  assert.equal(manifest.baseCssSource, "SteamTracking GameTracking-Deadlock");
  assert.equal(
    manifest.baseSource,
    "https://github.com/SteamTracking/GameTracking-Deadlock/tree/master/game/citadel/pak01_dir/panorama/styles"
  );
  assert.equal(manifest.scriptMinifier, "terser");
  assert.deepEqual(manifest.scaleOptions?.hudUiScale?.paths, HUD_UI_SCALE_PATCHED_PATHS);
  assert.equal(manifest.scaleOptions?.hudUiScale?.default, DEFAULT_HUD_UI_SCALE);
  assert.equal(manifest.scaleOptions?.hudUiScale?.min, MIN_HUD_UI_SCALE);
  assert.equal(manifest.scaleOptions?.hudUiScale?.max, MAX_HUD_UI_SCALE);
  assert.deepEqual(
    Object.keys(manifest.scaleOptions?.hudUiScale?.variants || {}).map(Number),
    Array.from({ length: DEFAULT_HUD_UI_SCALE - MIN_HUD_UI_SCALE }, (_, index) => MIN_HUD_UI_SCALE + index)
  );
  assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(manifest.scriptSourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(
    manifest.scriptSource,
    `https://github.com/Hantu-Raya/Deadlock-mods-collection/blob/${manifest.scriptSourceCommit}/3d%20hud/panorama/scripts/3d_hero_dynamic.js`
  );
  assert.match(manifest.baseSourceCommit, /^[0-9a-f]{40}$/);

  const normalized = manifest.files.map(normalizeVpkPath);
  assert.equal(new Set(normalized).size, normalized.length);

  await Promise.all(manifest.files.map(async (filePath) => {
    const fileUrl = new URL(`../public/payload/3d-hud/${filePath}`, import.meta.url);
    const info = await stat(fileUrl);
    assert.ok(info.isFile(), `${filePath} should be a file`);
    assert.ok(info.size > 0, `${filePath} should not be empty`);
  }));

  const defaultSignatures = manifest.scaleOptions.hudUiScale.defaultSignatures;
  for (const filePath of HUD_UI_SCALE_PATCHED_PATHS) {
    assert.equal(typeof defaultSignatures[filePath]?.size, "number");
    assert.match(defaultSignatures[filePath]?.crc32, /^[0-9a-f]{8}$/);
  }

  const variants = manifest.scaleOptions.hudUiScale.variants;
  const variantChecks = [];
  for (let scale = MIN_HUD_UI_SCALE; scale < DEFAULT_HUD_UI_SCALE; scale += 1) {
    const variant = variants[String(scale)];
    for (const filePath of HUD_UI_SCALE_PATCHED_PATHS) {
      const entry = variant[filePath];
      assert.equal(typeof entry?.size, "number");
      assert.match(entry?.crc32, /^[0-9a-f]{8}$/);
      variantChecks.push(async () => {
        const fileUrl = new URL(`../public/payload/3d-hud/${entry.file}`, import.meta.url);
        const info = await stat(fileUrl);
        assert.ok(info.isFile(), `${entry.file} should be a file`);
        assert.ok(info.size > 0, `${entry.file} should not be empty`);
      });
    }
  }
  await Promise.all(variantChecks.map((check) => check()));
});

test("hud_health payload temporarily omits anita_persist_loader script include", async () => {
  const fileUrl = new URL("../public/payload/3d-hud/panorama/layout/hud_health.vxml_c", import.meta.url);
  const source = decompilePanoramaLayoutResource(new Uint8Array(await readFile(fileUrl))).source;

  assert.doesNotMatch(source, /s2r:\/\/panorama\/scripts\/anita_persist_loader\.vjs_c/);
  assert.doesNotMatch(source, /<scripts>\s*<\/scripts>/);
});

test("HUD UI scale variants contain the selected compiled scale source", async () => {
  const manifestUrl = new URL("../public/payload/3d-hud/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const variant = manifest.scaleOptions.hudUiScale.variants["120"];

  const hudScaleBytes = new Uint8Array(await readFile(new URL(`../public/payload/3d-hud/${variant["panorama/styles/3d_hud.vcss_c"].file}`, import.meta.url)));
  const healthContainerBytes = new Uint8Array(await readFile(new URL(`../public/payload/3d-hud/${variant["panorama/styles/hud_health_container.vcss_c"].file}`, import.meta.url)));
  const hudScaleSource = decompileTextResource(hudScaleBytes, { panoramaPrelude: true }).source;
  const healthContainerSource = decompileTextResource(healthContainerBytes, { panoramaPrelude: true }).source;

  assert.match(hudScaleSource, /#health_and_abilities_container\s*\{[\s\S]*ui-scale:\s*120%;/);
  assert.match(hudScaleSource, /\.AspectRatio16x10\s+#health_and_abilities_container\s*\{[\s\S]*margin-right:\s*727px;/);
  assert.match(healthContainerSource, /#HealthRegenAndTotal\s*\{[\s\S]*margin-right:\s*14px;/);
  assert.match(healthContainerSource, /#RecentDamageContainer\s*,\s*\.recentDamageCounters\s*\{[\s\S]*margin-top:\s*-25px;/);
});
