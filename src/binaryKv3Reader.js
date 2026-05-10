const MAGIC_VKV3 = 0x03564b56;
const MAGIC_KV3_PREFIX = 0x4b563300;
const TRAILER = 0xffeedd00;

const KV_TYPE = {
  NULL: 1,
  BOOLEAN: 2,
  INT64: 3,
  UINT64: 4,
  DOUBLE: 5,
  STRING: 6,
  BINARY_BLOB: 7,
  ARRAY: 8,
  OBJECT: 9,
  ARRAY_TYPED: 10,
  INT32: 11,
  UINT32: 12,
  BOOLEAN_TRUE: 13,
  BOOLEAN_FALSE: 14,
  INT64_ZERO: 15,
  INT64_ONE: 16,
  DOUBLE_ZERO: 17,
  DOUBLE_ONE: 18,
  FLOAT: 19,
  INT16: 20,
  UINT16: 21,
  INT32_AS_BYTE: 23,
  ARRAY_TYPE_BYTE_LENGTH: 24,
  ARRAY_TYPE_AUXILIARY_BUFFER: 25
};

function toBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function align(value, boundary) {
  return (value + boundary - 1) & ~(boundary - 1);
}

function segment(bytes) {
  return { bytes, offset: 0 };
}

function ensureAvailable(seg, size, label) {
  if (!seg || seg.offset + size > seg.bytes.byteLength) {
    throw new Error(`Binary KV3 ${label} buffer is out of bounds`);
  }
}

function take(seg, size, label) {
  ensureAvailable(seg, size, label);
  const out = seg.bytes.subarray(seg.offset, seg.offset + size);
  seg.offset += size;
  return out;
}

function viewFor(bytes, offset = 0, size = bytes.byteLength - offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, size);
}

function readUint8(seg, label = "uint8") {
  ensureAvailable(seg, 1, label);
  return seg.bytes[seg.offset++];
}

function readInt16(seg) {
  const value = viewFor(seg.bytes, seg.offset, 2).getInt16(0, true);
  seg.offset += 2;
  return value;
}

function readUint16(seg) {
  const value = viewFor(seg.bytes, seg.offset, 2).getUint16(0, true);
  seg.offset += 2;
  return value;
}

function readInt32(seg) {
  const value = viewFor(seg.bytes, seg.offset, 4).getInt32(0, true);
  seg.offset += 4;
  return value;
}

function readUint32(seg) {
  const value = viewFor(seg.bytes, seg.offset, 4).getUint32(0, true);
  seg.offset += 4;
  return value;
}

function readBigInt64(seg) {
  const value = viewFor(seg.bytes, seg.offset, 8).getBigInt64(0, true);
  seg.offset += 8;
  return value;
}

function readBigUint64(seg) {
  const value = viewFor(seg.bytes, seg.offset, 8).getBigUint64(0, true);
  seg.offset += 8;
  return value;
}

function readFloat32(seg) {
  const value = viewFor(seg.bytes, seg.offset, 4).getFloat32(0, true);
  seg.offset += 4;
  return value;
}

function readFloat64(seg) {
  const value = viewFor(seg.bytes, seg.offset, 8).getFloat64(0, true);
  seg.offset += 8;
  return value;
}

function readNullTermUtf8String(seg) {
  let end = seg.offset;
  while (end < seg.bytes.byteLength && seg.bytes[end] !== 0) end += 1;
  if (end >= seg.bytes.byteLength) {
    throw new Error("Binary KV3 string table is missing a null terminator");
  }
  const value = new TextDecoder().decode(seg.bytes.subarray(seg.offset, end));
  seg.offset = end + 1;
  return value;
}

function readStringById(context, id) {
  if (id === -1) return "";
  if (id < 0 || id >= context.strings.length) {
    throw new Error(`Binary KV3 string id ${id} is out of bounds`);
  }
  return context.strings[id];
}

function decompressLz4Block(inputBytes, outputSize) {
  const input = toBytes(inputBytes);
  const output = new Uint8Array(outputSize);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < input.byteLength) {
    const token = input[inputOffset++];
    let literalLength = token >>> 4;
    if (literalLength === 15) {
      let next;
      do {
        if (inputOffset >= input.byteLength) throw new Error("LZ4 literal length is out of bounds");
        next = input[inputOffset++];
        literalLength += next;
      } while (next === 255);
    }

    if (inputOffset + literalLength > input.byteLength || outputOffset + literalLength > output.byteLength) {
      throw new Error("LZ4 literal copy is out of bounds");
    }
    output.set(input.subarray(inputOffset, inputOffset + literalLength), outputOffset);
    inputOffset += literalLength;
    outputOffset += literalLength;

    if (inputOffset >= input.byteLength) break;
    if (inputOffset + 2 > input.byteLength) throw new Error("LZ4 match offset is out of bounds");

    const matchOffset = input[inputOffset] | (input[inputOffset + 1] << 8);
    inputOffset += 2;
    if (matchOffset === 0 || matchOffset > outputOffset) {
      throw new Error("LZ4 match offset is invalid");
    }

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let next;
      do {
        if (inputOffset >= input.byteLength) throw new Error("LZ4 match length is out of bounds");
        next = input[inputOffset++];
        matchLength += next;
      } while (next === 255);
    }
    matchLength += 4;

    if (outputOffset + matchLength > output.byteLength) {
      throw new Error("LZ4 match copy is out of bounds");
    }
    for (let i = 0; i < matchLength; i += 1) {
      output[outputOffset] = output[outputOffset - matchOffset];
      outputOffset += 1;
    }
  }

  if (outputOffset !== output.byteLength) {
    throw new Error(`LZ4 decode size mismatch: expected ${output.byteLength}, got ${outputOffset}`);
  }
  return output;
}

function readBufferBytes(reader, compressionMethod, compressedSize, uncompressedSize) {
  if (compressionMethod === 0) {
    return take(reader, uncompressedSize, "uncompressed data");
  }
  if (compressionMethod === 1) {
    return decompressLz4Block(take(reader, compressedSize, "compressed LZ4 data"), uncompressedSize);
  }
  if (compressionMethod === 2) {
    throw new Error("Binary KV3 ZSTD compression is not supported in the browser patcher yet");
  }
  throw new Error(`Binary KV3 compression method ${compressionMethod} is not supported`);
}

function splitBuffer(bytes, counts, { includeObjectLengths = false, version = 5 } = {}) {
  let offset = 0;
  const out = {};

  if (includeObjectLengths) {
    const size = counts.countObjects * 4;
    out.objectLengths = segment(bytes.subarray(offset, offset + size));
    offset += size;
  }

  out.bytes1 = segment(bytes.subarray(offset, offset + counts.countBytes1));
  offset += counts.countBytes1;

  if (counts.countBytes2 > 0) {
    offset = align(offset, 2);
  }
  out.bytes2 = segment(bytes.subarray(offset, offset + counts.countBytes2 * 2));
  offset += counts.countBytes2 * 2;

  if (counts.countBytes4 > 0) {
    offset = align(offset, 4);
  }
  out.bytes4 = segment(bytes.subarray(offset, offset + counts.countBytes4 * 4));
  offset += counts.countBytes4 * 4;

  if (counts.countBytes8 > 0) {
    offset = align(offset, 8);
  } else if (version < 5) {
    offset = align(offset, 8);
  }
  out.bytes8 = segment(bytes.subarray(offset, offset + counts.countBytes8 * 8));
  offset += counts.countBytes8 * 8;

  out.endOffset = offset;
  return out;
}

function readType(context) {
  let dataByte = readUint8(context.types, "type");
  let flag = 0;

  if (context.version >= 3) {
    if ((dataByte & 0x80) > 0) {
      dataByte &= 0x3f;
      flag = readUint8(context.types, "flag");
    }
  } else if ((dataByte & 0x80) > 0) {
    dataByte &= 0x7f;
    flag = readUint8(context.types, "flag");
  }

  return { type: dataByte, flag };
}

function kvArray(items = []) {
  return { kind: "array", items };
}

function kvObject(entries = []) {
  return { kind: "object", entries };
}

function parseBinaryEntry(context, parent) {
  const { type, flag } = readType(context);
  if (parent.kind === "array") {
    parent.items.push(readBinaryValue(context, type, flag));
    return;
  }
  const key = readStringById(context, readInt32(context.buffer.bytes4));
  parent.entries.push({ key, value: readBinaryValue(context, type, flag) });
}

function readBinaryValue(context, type, flag) {
  const value = readValue(context, type);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value.flag = flag;
  }
  return value;
}

function readValue(context, type) {
  const buffer = context.buffer;

  switch (type) {
    case KV_TYPE.NULL:
      return null;
    case KV_TYPE.BOOLEAN_TRUE:
      return true;
    case KV_TYPE.BOOLEAN_FALSE:
      return false;
    case KV_TYPE.INT64_ZERO:
      return 0n;
    case KV_TYPE.INT64_ONE:
      return 1n;
    case KV_TYPE.DOUBLE_ZERO:
      return 0;
    case KV_TYPE.DOUBLE_ONE:
      return 1;
    case KV_TYPE.BOOLEAN:
      return readUint8(buffer.bytes1) === 1;
    case KV_TYPE.INT32_AS_BYTE:
      return readUint8(buffer.bytes1);
    case KV_TYPE.INT16:
      return readInt16(buffer.bytes2);
    case KV_TYPE.UINT16:
      return readUint16(buffer.bytes2);
    case KV_TYPE.INT32:
      return readInt32(buffer.bytes4);
    case KV_TYPE.UINT32:
      return readUint32(buffer.bytes4);
    case KV_TYPE.FLOAT:
      return readFloat32(buffer.bytes4);
    case KV_TYPE.INT64:
      return readBigInt64(buffer.bytes8);
    case KV_TYPE.UINT64:
      return readBigUint64(buffer.bytes8);
    case KV_TYPE.DOUBLE:
      return readFloat64(buffer.bytes8);
    case KV_TYPE.STRING:
      return readStringById(context, readInt32(buffer.bytes4));
    case KV_TYPE.BINARY_BLOB: {
      const blockLength = readInt32(context.binaryBlobLengths);
      return take(context.binaryBlobs, blockLength, "binary blob");
    }
    case KV_TYPE.ARRAY: {
      const length = readInt32(buffer.bytes4);
      const array = kvArray();
      for (let i = 0; i < length; i += 1) {
        parseBinaryEntry(context, array);
      }
      return array;
    }
    case KV_TYPE.ARRAY_TYPED:
    case KV_TYPE.ARRAY_TYPE_BYTE_LENGTH: {
      const length = type === KV_TYPE.ARRAY_TYPE_BYTE_LENGTH ? readUint8(buffer.bytes1) : readInt32(buffer.bytes4);
      const subType = readType(context);
      const array = kvArray();
      for (let i = 0; i < length; i += 1) {
        array.items.push(readBinaryValue(context, subType.type, subType.flag));
      }
      return array;
    }
    case KV_TYPE.ARRAY_TYPE_AUXILIARY_BUFFER: {
      const length = readUint8(buffer.bytes1);
      const subType = readType(context);
      const array = kvArray();
      const previousBuffer = context.buffer;
      context.buffer = context.auxiliaryBuffer;
      context.auxiliaryBuffer = previousBuffer;
      for (let i = 0; i < length; i += 1) {
        array.items.push(readBinaryValue(context, subType.type, subType.flag));
      }
      context.auxiliaryBuffer = context.buffer;
      context.buffer = previousBuffer;
      return array;
    }
    case KV_TYPE.OBJECT: {
      const length = context.version >= 5 ? readInt32(context.objectLengths) : readInt32(buffer.bytes4);
      const object = kvObject();
      for (let i = 0; i < length; i += 1) {
        parseBinaryEntry(context, object);
      }
      return object;
    }
    default:
      throw new Error(`Unknown Binary KV3 node type ${type}`);
  }
}

export function readBinaryKv3(inputBytes) {
  const bytes = toBytes(inputBytes);
  const reader = segment(bytes);
  const magic = readUint32(reader);

  if (magic === MAGIC_VKV3) {
    throw new Error("Legacy Binary KV3 resources are not supported in the browser patcher yet");
  }

  const version = magic & 0xff;
  if ((magic & 0xffffff00) !== MAGIC_KV3_PREFIX || version < 1 || version > 5) {
    throw new Error("Unsupported Binary KV3 signature");
  }
  if (version !== 5) {
    throw new Error(`Binary KV3 version ${version} is not supported in the browser patcher yet`);
  }

  take(reader, 16, "format guid");
  const compressionMethod = readUint32(reader);
  const compressionDictionaryId = readUint16(reader);
  const compressionFrameSize = readUint16(reader);
  if (compressionDictionaryId !== 0) {
    throw new Error("Binary KV3 compression dictionaries are not supported");
  }
  if (compressionMethod === 1 && compressionFrameSize !== 16384) {
    throw new Error(`Binary KV3 LZ4 frame size ${compressionFrameSize} is not supported`);
  }

  const countBytes1 = readInt32(reader);
  const countBytes4 = readInt32(reader);
  const countBytes8 = readInt32(reader);
  const countTypes = readInt32(reader);
  readUint16(reader);
  readUint16(reader);
  const sizeUncompressedTotal = readInt32(reader);
  readInt32(reader);
  const countBlocks = readInt32(reader);
  const sizeBinaryBlobsBytes = readInt32(reader);
  const countBytes2 = readInt32(reader);
  const sizeBlockCompressedSizesBytes = readInt32(reader);
  const sizeUncompressedBuffer1 = readInt32(reader);
  const sizeCompressedBuffer1 = readInt32(reader);
  const sizeUncompressedBuffer2 = readInt32(reader);
  const sizeCompressedBuffer2 = readInt32(reader);
  const countBytes1Buffer2 = readInt32(reader);
  const countBytes2Buffer2 = readInt32(reader);
  const countBytes4Buffer2 = readInt32(reader);
  const countBytes8Buffer2 = readInt32(reader);
  readInt32(reader);
  const countObjectsBuffer2 = readInt32(reader);
  readInt32(reader);
  readInt32(reader);

  if (sizeUncompressedTotal !== sizeUncompressedBuffer1 + sizeUncompressedBuffer2) {
    throw new Error("Binary KV3 buffer sizes do not add up");
  }
  if (countBlocks !== 0 || sizeBinaryBlobsBytes !== 0 || sizeBlockCompressedSizesBytes !== 0) {
    throw new Error("Binary KV3 external binary blob blocks are not supported in the browser patcher yet");
  }

  const buffer1Bytes = readBufferBytes(reader, compressionMethod, sizeCompressedBuffer1, sizeUncompressedBuffer1);
  const buffer2Bytes = readBufferBytes(reader, compressionMethod, sizeCompressedBuffer2, sizeUncompressedBuffer2);

  const buffer1 = splitBuffer(buffer1Bytes, {
    countBytes1,
    countBytes2,
    countBytes4,
    countBytes8
  }, { version });

  const stringCount = readInt32(buffer1.bytes4);
  const strings = [];
  for (let i = 0; i < stringCount; i += 1) {
    strings.push(readNullTermUtf8String(buffer1.bytes1));
  }

  const buffer2 = splitBuffer(buffer2Bytes, {
    countBytes1: countBytes1Buffer2,
    countBytes2: countBytes2Buffer2,
    countBytes4: countBytes4Buffer2,
    countBytes8: countBytes8Buffer2,
    countObjects: countObjectsBuffer2
  }, { includeObjectLengths: true, version });

  const typesEnd = buffer2.endOffset + countTypes;
  const types = segment(buffer2Bytes.subarray(buffer2.endOffset, typesEnd));
  const trailer = viewFor(buffer2Bytes, typesEnd, 4).getUint32(0, true);
  if (trailer !== TRAILER) {
    throw new Error("Binary KV3 trailer is invalid");
  }

  const context = {
    version,
    strings,
    types,
    buffer: buffer2,
    auxiliaryBuffer: buffer1,
    objectLengths: buffer2.objectLengths,
    binaryBlobLengths: segment(new Uint8Array()),
    binaryBlobs: segment(new Uint8Array())
  };

  const rootType = readType(context);
  return readBinaryValue(context, rootType.type, rootType.flag);
}
