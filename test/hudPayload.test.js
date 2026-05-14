import assert from "node:assert/strict";
import test from "node:test";

import { loadHudScaleVariant } from "../src/hudPayload.js";

function responseForBytes(bytes) {
  return new Response(bytes, { status: 200 });
}

test("loadHudScaleVariant returns no fetches for the default HUD UI scale", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return responseForBytes(new Uint8Array([1]));
  };

  try {
    const files = await loadHudScaleVariant("/3d-hud-web-merger/", {}, 170);
    assert.equal(files.size, 0);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("loadHudScaleVariant fetches the selected compiled scale variant files", async () => {
  const previousFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return responseForBytes(new Uint8Array([requestedUrls.length]));
  };

  const manifest = {
    scaleOptions: {
      hudUiScale: {
        paths: [
          "panorama/styles/3d_hud.vcss_c",
          "panorama/styles/hud_health_container.vcss_c"
        ],
        variants: {
          120: {
            "panorama/styles/3d_hud.vcss_c": {
              file: "options/hud-ui-scale/120/panorama/styles/3d_hud.vcss_c"
            },
            "panorama/styles/hud_health_container.vcss_c": {
              file: "options/hud-ui-scale/120/panorama/styles/hud_health_container.vcss_c"
            }
          }
        }
      }
    }
  };

  try {
    const files = await loadHudScaleVariant("/3d-hud-web-merger/", manifest, 120);
    assert.deepEqual(requestedUrls, [
      "/3d-hud-web-merger/payload/3d-hud/options/hud-ui-scale/120/panorama/styles/3d_hud.vcss_c",
      "/3d-hud-web-merger/payload/3d-hud/options/hud-ui-scale/120/panorama/styles/hud_health_container.vcss_c"
    ]);
    assert.deepEqual([...files.get("panorama/styles/3d_hud.vcss_c")], [1]);
    assert.deepEqual([...files.get("panorama/styles/hud_health_container.vcss_c")], [2]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("loadHudScaleVariant rejects missing scale variant metadata", async () => {
  await assert.rejects(
    () => loadHudScaleVariant("/3d-hud-web-merger/", { scaleOptions: { hudUiScale: { variants: {} } } }, 120),
    /does not include a compiled HUD UI scale variant for 120%/
  );
});
