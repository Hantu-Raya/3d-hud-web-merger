import assert from "node:assert/strict";
import test from "node:test";

import { parseVpk } from "../src/vpkReader.js";
import { findPathConflicts, createMergedFiles, normalizeVpkPath } from "../src/vpkMerge.js";
import { writeVpk } from "../src/vpkWriter.js";

const textEncoder = new TextEncoder();

function file(path, text) {
  return { path, bytes: textEncoder.encode(text) };
}

test("normalizeVpkPath lowercases paths, uses slashes, and removes leading slashes", () => {
  assert.equal(normalizeVpkPath("\\Panorama\\Layout\\HUD.vxml_c"), "panorama/layout/hud.vxml_c");
});

test("findPathConflicts blocks exact payload conflicts case-insensitively", () => {
  const conflicts = findPathConflicts(
    [file("Panorama\\Layout\\HUD.vxml_c", "existing")],
    [file("panorama/layout/hud.vxml_c", "payload")]
  );

  assert.deepEqual(conflicts, [{
    path: "panorama/layout/hud.vxml_c",
    existingPath: "Panorama\\Layout\\HUD.vxml_c",
    payloadPath: "panorama/layout/hud.vxml_c"
  }]);
});

test("createMergedFiles preserves existing files first and appends payload files", () => {
  const existingFiles = [file("panorama/scripts/existing.vjs_c", "existing")];
  const payloadFiles = [file("panorama/scripts/3d_hero_dynamic.vjs_c", "payload")];

  const merged = createMergedFiles(existingFiles, payloadFiles);

  assert.deepEqual(merged.map((entry) => entry.path), [
    "panorama/scripts/existing.vjs_c",
    "panorama/scripts/3d_hero_dynamic.vjs_c"
  ]);
  assert.notEqual(merged[0], existingFiles[0]);
  assert.notEqual(merged[1], payloadFiles[0]);
});

test("merged files can be repacked and parsed back with original and payload entries", () => {
  const existingFiles = [file("panorama/scripts/existing.vjs_c", "existing")];
  const payloadFiles = [file("panorama/scripts/3d_hero_dynamic.vjs_c", "payload")];
  const merged = createMergedFiles(existingFiles, payloadFiles);

  const parsed = parseVpk(writeVpk(merged));

  assert.deepEqual(parsed.files.map((entry) => entry.path).sort(), [
    "panorama/scripts/3d_hero_dynamic.vjs_c",
    "panorama/scripts/existing.vjs_c"
  ]);
});
