import assert from "node:assert/strict";
import test from "node:test";

import { patchHudHealthLayoutSource } from "../src/hudHealthPatch.js";

const existingHealth = [
  "<root>",
  "  <styles>",
  "    <include src=\"s2r://panorama/styles/hud_health.vcss_c\" />",
  "  </styles>",
  "  <scripts>",
  "    <include src=\"s2r://panorama/scripts/anita_persist_loader.vjs_c\" />",
  "  </scripts>",
  "  <Panel class=\"bars_container\" hittest=\"false\">",
  "    <Panel class=\"health_bar_line old_health_layout\">",
  "      <Panel id=\"health_bar\" />",
  "    </Panel>",
  "  </Panel>",
  "</root>"
].join("\n");

const payloadHealth = [
  "<root>",
  "  <styles>",
  "    <include src=\"s2r://panorama/styles/hud_health.vcss_c\" />",
  "  </styles>",
  "  <Panel class=\"bars_container\" hittest=\"false\">",
  "    <Panel class=\"hp_custom_health_root\">",
  "      <Panel id=\"hp_progress_source\" class=\"health_bar_line hp_progress_source\" />",
  "      <Panel id=\"hp_custom_text\" class=\"hp_custom_text\" />",
  "    </Panel>",
  "  </Panel>",
  "</root>"
].join("\n");

test("patchHudHealthLayoutSource preserves existing scripts and replaces health body", () => {
  const patched = patchHudHealthLayoutSource(existingHealth, payloadHealth);

  assert.match(patched, /anita_persist_loader\.vjs_c/);
  assert.match(patched, /hp_custom_health_root/);
  assert.match(patched, /hp_custom_text/);
  assert.doesNotMatch(patched, /old_health_layout/);
  assert.equal(patched.match(/class="bars_container"/g).length, 1);
});

test("patchHudHealthLayoutSource rejects layouts without bars_container", () => {
  assert.throws(
    () => patchHudHealthLayoutSource("<root />", payloadHealth),
    /bars_container/i
  );
  assert.throws(
    () => patchHudHealthLayoutSource(existingHealth, "<root />"),
    /bars_container/i
  );
});
