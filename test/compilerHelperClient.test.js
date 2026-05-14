import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompilerHelperFetchOptions,
  compilerHelperEndpoint,
  DEFAULT_COMPILER_HELPER_URL,
  isLocalHelperAccessBlockedError,
  normalizeCompilerHelperUrl
} from "../src/compilerHelperClient.js";

test("compiler helper URL helpers normalize endpoint paths", () => {
  assert.equal(normalizeCompilerHelperUrl("http://127.0.0.1:4329///"), DEFAULT_COMPILER_HELPER_URL);
  assert.equal(compilerHelperEndpoint("http://127.0.0.1:4329/", "/health"), "http://127.0.0.1:4329/health");
  assert.equal(compilerHelperEndpoint("http://127.0.0.1:4329", "merge"), "http://127.0.0.1:4329/merge");
});

test("compiler helper fetch options request loopback access without dropping caller options", () => {
  assert.deepEqual(
    buildCompilerHelperFetchOptions({
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" }
    }),
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      targetAddressSpace: "loopback"
    }
  );
});

test("isLocalHelperAccessBlockedError detects browser network fetch failures", () => {
  assert.equal(isLocalHelperAccessBlockedError(new TypeError("Failed to fetch")), true);
  assert.equal(isLocalHelperAccessBlockedError(new Error("Network request failed")), true);
  assert.equal(isLocalHelperAccessBlockedError(new Error("Compiler not found")), false);
});
