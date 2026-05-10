import assert from "node:assert/strict";
import test from "node:test";

import { parseVpk } from "../src/vpkReader.js";
import { writeVpk } from "../src/vpkWriter.js";

function fixtureVpk(files = [
  { path: "panorama/scripts/demo.vjs_c", bytes: new TextEncoder().encode("demo script") },
  { path: "panorama/layout/demo.vxml_c", bytes: new TextEncoder().encode("<root />") }
]) {
  return writeVpk(files);
}

function readCString(bytes, pos) {
  let end = pos;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  return { value: new TextDecoder().decode(bytes.slice(pos, end)), next: end + 1 };
}

function firstEntryOffset(bytes) {
  let pos = 28;
  const ext = readCString(bytes, pos); pos = ext.next;
  const dir = readCString(bytes, pos); pos = dir.next;
  const name = readCString(bytes, pos); pos = name.next;
  assert.ok(ext.value && dir.value && name.value);
  return pos;
}

function mutableCopy(bytes) {
  return new Uint8Array(bytes);
}

test("parseVpk reads VPK v2 embedded entries and preserves paths and bytes", () => {
  const expectedFiles = [
    { path: "panorama/scripts/demo.vjs_c", bytes: new TextEncoder().encode("demo script") },
    { path: "panorama/layout/demo.vxml_c", bytes: new TextEncoder().encode("<root />") }
  ];

  const parsed = parseVpk(fixtureVpk(expectedFiles));

  assert.deepEqual(parsed.files.map((file) => file.path).sort(), expectedFiles.map((file) => file.path).sort());
  const parsedFileByPath = new Map(parsed.files.map((file) => [file.path, file]));
  for (const expected of expectedFiles) {
    const actual = parsedFileByPath.get(expected.path);
    assert.ok(actual);
    assert.deepEqual(Array.from(actual.bytes), Array.from(expected.bytes));
  }
  assert.equal(parsed.entries.length, expectedFiles.length);
});

test("parseVpk rejects files with a non-VPK magic", () => {
  const bytes = mutableCopy(fixtureVpk());
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 0, true);

  assert.throws(() => parseVpk(bytes), /Invalid VPK magic/i);
});

test("parseVpk rejects unsupported VPK versions", () => {
  const bytes = mutableCopy(fixtureVpk());
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(4, 1, true);

  assert.throws(() => parseVpk(bytes), /Unsupported VPK version/i);
});

test("parseVpk rejects malformed tree sizes", () => {
  const bytes = mutableCopy(fixtureVpk());
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(8, bytes.byteLength + 64, true);

  assert.throws(() => parseVpk(bytes), /tree size/i);
});

test("parseVpk rejects entries stored in external archives", () => {
  const bytes = mutableCopy(fixtureVpk());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(firstEntryOffset(bytes) + 6, 0, true);

  assert.throws(() => parseVpk(bytes), /external archive/i);
});

test("parseVpk rejects out-of-bounds file data", () => {
  const bytes = mutableCopy(fixtureVpk());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(firstEntryOffset(bytes) + 12, bytes.byteLength, true);

  assert.throws(() => parseVpk(bytes), /out of bounds/i);
});

test("parseVpk rejects duplicate normalized paths", () => {
  const bytes = writeVpk([
    { path: "panorama/scripts/demo.vjs_c", bytes: new TextEncoder().encode("one") },
    { path: "Panorama/Scripts/Demo.vjs_c", bytes: new TextEncoder().encode("two") }
  ]);

  assert.throws(() => parseVpk(bytes), /Duplicate VPK path/i);
});
