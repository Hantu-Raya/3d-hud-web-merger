import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decompilePanoramaLayoutResource } from "../src/source2ResourceReader.js";
import { compilePanoramaLayoutResource, compileTextResource } from "../src/source2ResourceWriter.js";

test("decompilePanoramaLayoutResource reads DATA layout resources", () => {
  const source = '<root><styles><include src="s2r://panorama/styles/demo.vcss_c" /></styles><Panel id="Demo" /></root>';

  const decompiled = decompilePanoramaLayoutResource(compilePanoramaLayoutResource(source));

  assert.equal(decompiled.source, source);
  assert.equal(decompiled.format, "DATA");
});

test("decompilePanoramaLayoutResource rejects generic text DATA resources", () => {
  assert.throws(
    () => decompilePanoramaLayoutResource(compileTextResource("<root />")),
    /Panorama layout DATA block is missing the CRC prelude/i
  );
});

test("decompilePanoramaLayoutResource reads LaCo binary AST layout resources", () => {
  const bytes = readFileSync(new URL("../public/payload/3d-hud/panorama/layout/hud.vxml_c", import.meta.url));

  const decompiled = decompilePanoramaLayoutResource(new Uint8Array(bytes));

  assert.equal(decompiled.format, "LaCo");
  assert.match(decompiled.source, /<root>/);
  assert.match(decompiled.source, /s2r:\/\/panorama\/styles\/3d_hud\.vcss_c/);
  assert.match(decompiled.source, /id="ThreeDHeroHudProbe"/);
});

test("decompilePanoramaLayoutResource rejects malformed resources", () => {
  assert.throws(
    () => decompilePanoramaLayoutResource(new Uint8Array([1, 2, 3, 4])),
    /Source 2 resource is too small/i
  );
});
