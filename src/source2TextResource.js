const HEADER_SIZE = 16;
const BLOCK_ENTRY_SIZE = 12;
const FOURCC_DATA = "DATA";

function toBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function readFourCc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function looksLikeSource2Resource(bytes) {
  if (bytes.byteLength < HEADER_SIZE + BLOCK_ENTRY_SIZE) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(0, true);
  const blockOffset = view.getUint32(8, true);
  const blockCount = view.getUint32(12, true);
  return declaredSize <= bytes.byteLength && blockOffset === 8 && blockCount > 0 && blockCount < 64;
}

function parseSource2Blocks(inputBytes) {
  const bytes = toBytes(inputBytes);
  if (!looksLikeSource2Resource(bytes)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blockCount = view.getUint32(12, true);
  const blockTableStart = HEADER_SIZE;
  const blockTableEnd = blockTableStart + blockCount * BLOCK_ENTRY_SIZE;
  if (blockTableEnd > bytes.byteLength) {
    throw new Error("Source 2 text resource has a malformed block table");
  }

  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const entryOffset = blockTableStart + index * BLOCK_ENTRY_SIZE;
    const type = readFourCc(bytes, entryOffset);
    const dataOffset = entryOffset + 4 + view.getUint32(entryOffset + 4, true);
    const size = view.getUint32(entryOffset + 8, true);
    const end = dataOffset + size;
    if (dataOffset < blockTableEnd || end > bytes.byteLength || end < dataOffset) {
      throw new Error(`Source 2 text resource block ${type} is out of bounds`);
    }
    blocks.push({ type, offset: dataOffset, size });
  }

  return { bytes, blocks };
}

function readCStringEnd(bytes, offset, limit) {
  let end = offset;
  while (end < limit && bytes[end] !== 0) end += 1;
  if (end >= limit) return -1;
  return end + 1;
}

function tryReadPanoramaDataText(bytes, offset, size) {
  if (size < 6) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameCount = view.getUint16(offset + 4, true);
  if (nameCount > 4096) return null;

  let cursor = offset + 6;
  const end = offset + size;
  for (let index = 0; index < nameCount; index += 1) {
    cursor = readCStringEnd(bytes, cursor, end);
    if (cursor < 0 || cursor + 8 > end) return null;
    cursor += 8;
  }
  if (cursor >= end) return null;

  return decodeUtf8(bytes.slice(cursor, end));
}

export function decompileTextResource(inputBytes, options = {}) {
  const bytes = toBytes(inputBytes);
  const parsed = parseSource2Blocks(bytes);
  if (!parsed) {
    return { format: "RAW", source: decodeUtf8(bytes) };
  }

  const dataBlock = parsed.blocks.find((block) => block.type === FOURCC_DATA);
  if (!dataBlock) {
    throw new Error("Source 2 text resource has no DATA block");
  }

  if (options.panoramaPrelude) {
    const panoramaText = tryReadPanoramaDataText(parsed.bytes, dataBlock.offset, dataBlock.size);
    if (panoramaText != null) {
      return { format: FOURCC_DATA, source: panoramaText };
    }
  }

  return {
    format: FOURCC_DATA,
    source: decodeUtf8(parsed.bytes.slice(dataBlock.offset, dataBlock.offset + dataBlock.size))
  };
}
