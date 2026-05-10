import { crc32 } from "./crc32.js";
import { readBinaryKv3 } from "./binaryKv3Reader.js";
import { printPanoramaLayout } from "./panoramaLayoutPrinter.js";

const HEADER_SIZE = 16;
const BLOCK_ENTRY_SIZE = 12;
const FOURCC_DATA = "DATA";
const FOURCC_LACO = "LaCo";

function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  return new Uint8Array(bytes);
}

function readFourCc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readCString(bytes, offset, limit) {
  let end = offset;
  while (end < limit && bytes[end] !== 0) end += 1;
  if (end >= limit) {
    throw new Error("Panorama layout DATA block is missing the CRC prelude or has a malformed name table");
  }
  return end + 1;
}

function parseSource2Blocks(inputBytes) {
  const bytes = toBytes(inputBytes);
  if (bytes.byteLength < HEADER_SIZE + BLOCK_ENTRY_SIZE) {
    throw new Error("Source 2 resource is too small");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(0, true);
  if (declaredSize > bytes.byteLength) {
    throw new Error("Source 2 resource declares a size larger than the file");
  }

  const blockOffset = view.getUint32(8, true);
  const blockCount = view.getUint32(12, true);
  const blockTableStart = HEADER_SIZE;
  const blockTableEnd = blockTableStart + blockCount * BLOCK_ENTRY_SIZE;
  if (blockOffset !== 8 || blockCount < 1 || blockTableEnd > bytes.byteLength) {
    throw new Error("Source 2 resource has a malformed block table");
  }

  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const entryOffset = blockTableStart + index * BLOCK_ENTRY_SIZE;
    const type = readFourCc(bytes, entryOffset);
    const dataOffset = entryOffset + 4 + view.getUint32(entryOffset + 4, true);
    const size = view.getUint32(entryOffset + 8, true);
    const end = dataOffset + size;
    if (dataOffset < blockTableEnd || end > bytes.byteLength || end < dataOffset) {
      throw new Error(`Source 2 resource block ${type} is out of bounds`);
    }
    blocks.push({ type, offset: dataOffset, size });
  }
  return { bytes, blocks };
}

function readPanoramaDataPayload(bytes, offset, size) {
  if (size < 6) {
    throw new Error("Panorama layout DATA block is missing the CRC prelude");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expectedCrc = view.getUint32(offset, true);
  const nameCount = view.getUint16(offset + 4, true);
  let cursor = offset + 6;
  const end = offset + size;

  try {
    for (let i = 0; i < nameCount; i += 1) {
      cursor = readCString(bytes, cursor, end);
      if (cursor + 8 > end) {
        throw new Error("name table is out of bounds");
      }
      cursor += 8;
    }
  } catch {
    throw new Error("Panorama layout DATA block is missing the CRC prelude or has a malformed name table");
  }

  const sourceBytes = bytes.slice(cursor, end);
  if (sourceBytes.byteLength === 0) {
    throw new Error("Panorama layout DATA block has no XML payload");
  }
  if (crc32(sourceBytes) !== expectedCrc) {
    throw new Error("Panorama layout DATA block CRC32 mismatch; this is not a supported layout DATA resource");
  }

  return decodeUtf8(sourceBytes);
}

export function decompilePanoramaLayoutResource(inputBytes) {
  const { bytes, blocks } = parseSource2Blocks(inputBytes);
  const lacoBlock = blocks.find((block) => block.type === FOURCC_LACO);
  if (lacoBlock) {
    return {
      format: FOURCC_LACO,
      source: printPanoramaLayout(readBinaryKv3(bytes.slice(lacoBlock.offset, lacoBlock.offset + lacoBlock.size)))
    };
  }

  const dataBlock = blocks.find((block) => block.type === FOURCC_DATA);
  if (!dataBlock) {
    throw new Error("Source 2 resource has no DATA block to decompile");
  }

  return {
    format: FOURCC_DATA,
    source: readPanoramaDataPayload(bytes, dataBlock.offset, dataBlock.size)
  };
}
