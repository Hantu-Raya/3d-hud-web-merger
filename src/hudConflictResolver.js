import { isCssHijackBasePath } from "./cssHijackPaths.js";
import { createMergedFiles, findPathConflicts, normalizeVpkPath } from "./vpkMerge.js";

const HUD_LAYOUT_PATH = "panorama/layout/hud.vxml_c";
const HUD_HEALTH_LAYOUT_PATH = "panorama/layout/hud_health.vxml_c";
const HUD_DYNAMIC_SCRIPT_PATH = "panorama/scripts/3d_hero_dynamic.vjs_c";
const LAYOUT_CONFLICT_REASON = "Compiled layout conflicts require compiler-backed layout patching; browser DATA-only vxml_c output is disabled because it can crash Deadlock";
const PATCHABLE_STYLE_PATHS = new Set([
  "panorama/styles/citadel_status_effect.vcss_c",
  "panorama/styles/hud_health.vcss_c",
  "panorama/styles/hud_health_container.vcss_c"
]);

function cloneFile(file) {
  return {
    path: String(file.path),
    bytes: file.bytes instanceof Uint8Array ? new Uint8Array(file.bytes) : new Uint8Array(file.bytes)
  };
}

function isHudLayout(path) {
  return normalizeVpkPath(path) === HUD_LAYOUT_PATH;
}

function isHudHealthLayout(path) {
  return normalizeVpkPath(path) === HUD_HEALTH_LAYOUT_PATH;
}

function isHudDynamicScript(path) {
  return normalizeVpkPath(path) === HUD_DYNAMIC_SCRIPT_PATH;
}

function isPatchableStyle(path) {
  return PATCHABLE_STYLE_PATHS.has(normalizeVpkPath(path));
}

function bytesEqual(left, right) {
  const leftBytes = left instanceof Uint8Array ? left : new Uint8Array(left);
  const rightBytes = right instanceof Uint8Array ? right : new Uint8Array(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function createFileMap(files) {
  const filesByPath = new Map();
  for (const file of files || []) {
    filesByPath.set(normalizeVpkPath(file.path), file);
  }
  return filesByPath;
}

function annotateConflict(conflict, reason, resolution = "Blocked") {
  return { ...conflict, reason, resolution };
}

function annotateConflicts(conflicts, reason, resolution = "Blocked") {
  const annotated = [];
  for (const conflict of conflicts) {
    annotated.push(annotateConflict(conflict, reason, resolution));
  }
  return annotated;
}

function replaceFileBytes(files, path, bytes) {
  const normalized = normalizeVpkPath(path);
  return files.map((file) => (
    normalizeVpkPath(file.path) === normalized ? { path: normalized, bytes } : file
  ));
}

export function resolveHudPayloadConflicts(existingFiles, payloadFiles) {
  const conflicts = findPathConflicts(existingFiles, payloadFiles);
  const existingFileByPath = createFileMap(existingFiles);
  const payloadFileByPath = createFileMap(payloadFiles);
  const identicalConflictPaths = new Set();
  const activeConflicts = [];
  const alreadyPresentConflicts = [];
  const payloadWithoutIdenticalConflicts = [];

  for (const conflict of conflicts) {
    const conflictPath = normalizeVpkPath(conflict.path);
    const existingFile = existingFileByPath.get(conflictPath);
    const payloadFile = payloadFileByPath.get(conflictPath);
    if (existingFile && payloadFile && bytesEqual(existingFile.bytes, payloadFile.bytes)) {
      identicalConflictPaths.add(conflictPath);
      alreadyPresentConflicts.push(annotateConflict(
        conflict,
        "Payload file is already present with identical bytes",
        "Keep existing file"
      ));
    } else {
      activeConflicts.push(conflict);
    }
  }

  for (const file of payloadFiles || []) {
    if (!identicalConflictPaths.has(normalizeVpkPath(file.path))) {
      payloadWithoutIdenticalConflicts.push(file);
    }
  }

  if (activeConflicts.length === 0) {
    return {
      files: createMergedFiles(existingFiles, payloadWithoutIdenticalConflicts),
      conflicts: alreadyPresentConflicts,
      blockedConflicts: [],
      patchedPaths: []
    };
  }

  const styleConflicts = [];
  const blockedConflicts = [];
  const baseCssConflicts = [];
  const scriptConflicts = [];

  for (const conflict of activeConflicts) {
    if (isHudLayout(conflict.path) || isHudHealthLayout(conflict.path)) {
      blockedConflicts.push(annotateConflict(conflict, LAYOUT_CONFLICT_REASON));
    } else if (isHudDynamicScript(conflict.path)) {
      scriptConflicts.push(conflict);
    } else if (isCssHijackBasePath(conflict.path)) {
      baseCssConflicts.push(conflict);
    } else if (isPatchableStyle(conflict.path)) {
      styleConflicts.push(conflict);
    } else {
      blockedConflicts.push(annotateConflict(conflict, "Only HUD layout and supported 3D HUD style conflicts can be patched"));
    }
  }

  let nextExistingFiles = (existingFiles || []).map(cloneFile);
  const patchedPaths = [];
  const resolvedConflicts = [];

  for (const conflict of baseCssConflicts) {
    const path = normalizeVpkPath(conflict.path);
    const payloadBaseCss = payloadFileByPath.get(path);
    if (!payloadBaseCss) {
      blockedConflicts.push(annotateConflict(
        conflict,
        "SteamTracking base CSS payload entry was not found after conflict detection"
      ));
      continue;
    }
    nextExistingFiles = replaceFileBytes(nextExistingFiles, path, cloneFile(payloadBaseCss).bytes);
    patchedPaths.push(path);
    resolvedConflicts.push(annotateConflict(
      conflict,
      "Existing base CSS will be updated to the bundled SteamTracking version",
      "Update SteamTracking base CSS"
    ));
  }

  for (const conflict of scriptConflicts) {
    const payloadScript = payloadFileByPath.get(HUD_DYNAMIC_SCRIPT_PATH);
    if (!payloadScript) {
      blockedConflicts.push(annotateConflict(
        conflict,
        "3D HUD runtime script payload entry was not found after conflict detection"
      ));
      continue;
    }
    nextExistingFiles = replaceFileBytes(nextExistingFiles, HUD_DYNAMIC_SCRIPT_PATH, cloneFile(payloadScript).bytes);
    patchedPaths.push(HUD_DYNAMIC_SCRIPT_PATH);
    resolvedConflicts.push(annotateConflict(
      conflict,
      "Existing 3D HUD runtime script will be updated to the bundled payload version",
      "Update 3D HUD script"
    ));
  }

  blockedConflicts.push(...annotateConflicts(
    styleConflicts,
    "Compiled CSS conflicts require compiler-backed patching; browser vcss_c output is disabled because Deadlock requires real Source 2 CSS resource blocks"
  ));

  if (blockedConflicts.length > 0) {
    return {
      files: null,
      conflicts: [...resolvedConflicts, ...alreadyPresentConflicts, ...blockedConflicts],
      blockedConflicts,
      patchedPaths
    };
  }

  const patchedPathSet = new Set(patchedPaths);
  const payloadWithoutPatchedHud = [];
  for (const file of payloadWithoutIdenticalConflicts) {
    const normalizedPath = normalizeVpkPath(file.path);
    if (!patchedPathSet.has(normalizedPath)) {
      payloadWithoutPatchedHud.push(cloneFile(file));
    }
  }

  return {
    files: createMergedFiles(nextExistingFiles, payloadWithoutPatchedHud),
    conflicts: [...resolvedConflicts, ...alreadyPresentConflicts],
    blockedConflicts: [],
    patchedPaths
  };
}
