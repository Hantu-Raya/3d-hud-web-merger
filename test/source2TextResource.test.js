import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decompileTextResource } from "../src/source2TextResource.js";
import { compileTextResource } from "../src/source2ResourceWriter.js";

test("decompileTextResource reads plain DATA text resources", () => {
  assert.equal(decompileTextResource(compileTextResource(".demo{width: 1px;}")).source, ".demo{width: 1px;}");
});

test("decompileTextResource reads Panorama style DATA resources with source-map CRC mismatch", () => {
  const bytes = new Uint8Array(readFileSync(new URL("../public/payload/3d-hud/panorama/styles/hud_health.vcss_c", import.meta.url)));
  const result = decompileTextResource(bytes, { panoramaPrelude: true });

  assert.match(result.source, /hp_custom_text/);
  assert.equal(result.format, "DATA");
});
