function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return new Uint8Array(bytes);
  return new Uint8Array(bytes);
}

function cloneFile(file) {
  return {
    path: String(file.path),
    bytes: toBytes(file.bytes)
  };
}

export function normalizeVpkPath(path) {
  return String(path || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

export function findPathConflicts(existingFiles, payloadFiles) {
  const existingByPath = new Map();
  for (const file of existingFiles || []) {
    const normalized = normalizeVpkPath(file.path);
    if (!normalized) continue;
    if (!existingByPath.has(normalized)) {
      existingByPath.set(normalized, file.path);
    }
  }

  const conflicts = [];
  for (const file of payloadFiles || []) {
    const normalized = normalizeVpkPath(file.path);
    const existingPath = existingByPath.get(normalized);
    if (!existingPath) continue;
    conflicts.push({
      path: normalized,
      existingPath,
      payloadPath: file.path
    });
  }
  return conflicts;
}

export function createMergedFiles(existingFiles, payloadFiles) {
  const conflicts = findPathConflicts(existingFiles, payloadFiles);
  if (conflicts.length > 0) {
    throw new Error(`Cannot merge VPK with ${conflicts.length} conflicting path${conflicts.length === 1 ? "" : "s"}`);
  }
  return [
    ...(existingFiles || []).map(cloneFile),
    ...(payloadFiles || []).map(cloneFile)
  ];
}
