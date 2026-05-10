import assert from "node:assert/strict";
import test from "node:test";

import { patchHudLayoutSource } from "../src/hudLayoutPatch.js";

const baseLayout = [
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

test("patchHudLayoutSource injects 3D HUD style, script, and probe panel", () => {
  const patched = patchHudLayoutSource(baseLayout, '<Panel id="ThreeDHeroHudProbe" />');

  assert.match(patched, /s2r:\/\/panorama\/styles\/3d_hud\.vcss_c/);
  assert.match(patched, /s2r:\/\/panorama\/scripts\/3d_hero_dynamic\.vjs_c/);
  assert.match(patched, /id="ThreeDHeroHudProbe"/);
  assert.match(patched, /<Panel id="ExistingHud" \/>/);
});

test("patchHudLayoutSource places the probe immediately after hud_hero_testing", () => {
  const patched = patchHudLayoutSource(baseLayout, '<Panel id="ThreeDHeroHudProbe" />');

  assert.match(
    patched,
    /<CitadelHudHeroTesting id="hud_hero_testing" \/>\s*<Panel id="ThreeDHeroHudProbe" \/>/
  );
  assert.ok(patched.indexOf('id="ThreeDHeroHudProbe"') < patched.indexOf('id="ExistingHud"'));
});

test("patchHudLayoutSource moves an existing misplaced probe after hud_hero_testing", () => {
  const misplaced = [
    "<root>",
    "  <CitadelHud>",
    "    <CitadelHudHeroTesting id=\"hud_hero_testing\" />",
    "    <Panel id=\"ExistingHud\" />",
    "    <Panel id=\"ThreeDHeroHudProbe\">",
    "      <Panel id=\"ThreeDHeroDynamicHeroHost\" />",
    "    </Panel>",
    "  </CitadelHud>",
    "</root>"
  ].join("\n");

  const patched = patchHudLayoutSource(misplaced, '<Panel id="ThreeDHeroHudProbe" />');

  assert.match(
    patched,
    /<CitadelHudHeroTesting id="hud_hero_testing" \/>\s*<Panel id="ThreeDHeroHudProbe">/
  );
  assert.equal(patched.match(/ThreeDHeroHudProbe/g).length, 1);
  assert.ok(patched.indexOf('id="ThreeDHeroHudProbe"') < patched.indexOf('id="ExistingHud"'));
});

test("patchHudLayoutSource creates a scripts block when missing", () => {
  const patched = patchHudLayoutSource(baseLayout, '<Panel id="ThreeDHeroHudProbe" />');

  assert.match(patched, /<scripts>[\s\S]*3d_hero_dynamic\.vjs_c[\s\S]*<\/scripts>/);
});

test("patchHudLayoutSource removes the temporary anita persist loader scripts block", () => {
  const layout = [
    "<root>",
    "  <scripts>",
    "    <include src=\"s2r://panorama/scripts/anita_persist_loader.vjs_c\" />",
    "  </scripts>",
    "  <CitadelHud>",
    "    <CitadelHudHeroTesting id=\"hud_hero_testing\" />",
    "  </CitadelHud>",
    "</root>"
  ].join("\n");

  const patched = patchHudLayoutSource(layout, '<Panel id="ThreeDHeroHudProbe" />');

  assert.doesNotMatch(patched, /anita_persist_loader\.vjs_c/);
  assert.match(patched, /<scripts>[\s\S]*3d_hero_dynamic\.vjs_c[\s\S]*<\/scripts>/);
});

test("patchHudLayoutSource removes only anita include when scripts has other entries", () => {
  const layout = [
    "<root>",
    "  <scripts>",
    "    <include src=\"s2r://panorama/scripts/keep_me.vjs_c\" />",
    "    <include src=\"s2r://panorama/scripts/anita_persist_loader.vjs_c\" />",
    "  </scripts>",
    "  <CitadelHud>",
    "    <CitadelHudHeroTesting id=\"hud_hero_testing\" />",
    "  </CitadelHud>",
    "</root>"
  ].join("\n");

  const patched = patchHudLayoutSource(layout, '<Panel id="ThreeDHeroHudProbe" />');

  assert.doesNotMatch(patched, /anita_persist_loader\.vjs_c/);
  assert.match(patched, /keep_me\.vjs_c/);
  assert.match(patched, /3d_hero_dynamic\.vjs_c/);
});

test("patchHudLayoutSource is idempotent", () => {
  const once = patchHudLayoutSource(baseLayout, '<Panel id="ThreeDHeroHudProbe" />');
  const twice = patchHudLayoutSource(once, '<Panel id="ThreeDHeroHudProbe" />');

  assert.equal(twice.match(/3d_hud\.vcss_c/g).length, 1);
  assert.equal(twice.match(/3d_hero_dynamic\.vjs_c/g).length, 1);
  assert.equal(twice.match(/ThreeDHeroHudProbe/g).length, 1);
});

test("patchHudLayoutSource rejects layouts without a CitadelHud close tag", () => {
  assert.throws(
    () => patchHudLayoutSource("<root />", '<Panel id="ThreeDHeroHudProbe" />'),
    /CitadelHud/i
  );
});
