import { patchHudHealthLayoutSource } from "./hudHealthPatch.js";
import { patchHudLayoutSource } from "./hudLayoutPatch.js";
import { isCssHijackBasePath } from "./cssHijackPaths.js";
import { decompilePanoramaLayoutResource } from "./source2ResourceReader.js";
import { compilePanoramaLayoutResource } from "./source2ResourceWriter.js";
import { createMergedFiles, findPathConflicts, normalizeVpkPath } from "./vpkMerge.js";

const HUD_LAYOUT_PATH = "panorama/layout/hud.vxml_c";
const HUD_HEALTH_LAYOUT_PATH = "panorama/layout/hud_health.vxml_c";
const HUD_DYNAMIC_SCRIPT_PATH = "panorama/scripts/3d_hero_dynamic.vjs_c";
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

export function resolveHudPayloadConflicts(existingFiles, payloadFiles, options = {}) {
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

  let hudConflicts = [];
  let hudHealthConflicts = [];
  const styleConflicts = [];
  const blockedConflicts = [];
  const baseCssConflicts = [];
  const scriptConflicts = [];

  for (const conflict of activeConflicts) {
    if (isHudLayout(conflict.path)) {
      hudConflicts.push(conflict);
    } else if (isHudHealthLayout(conflict.path)) {
      hudHealthConflicts.push(conflict);
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

  if (!options.allowDataLayoutPatching && (hudConflicts.length > 0 || hudHealthConflicts.length > 0)) {
    const layoutReason = "Compiled layout conflicts require compiler-backed layout patching; browser DATA-only vxml_c output is disabled because it can crash Deadlock";
    blockedConflicts.push(...annotateConflicts(hudConflicts, layoutReason));
    blockedConflicts.push(...annotateConflicts(hudHealthConflicts, layoutReason));
    hudConflicts = [];
    hudHealthConflicts = [];
  }

  let nextExistingFiles = (existingFiles || []).map(cloneFile);
  let nextExistingFileByPath = createFileMap(nextExistingFiles);
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
    nextExistingFileByPath = createFileMap(nextExistingFiles);
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
    nextExistingFileByPath = createFileMap(nextExistingFiles);
    patchedPaths.push(HUD_DYNAMIC_SCRIPT_PATH);
    resolvedConflicts.push(annotateConflict(
      conflict,
      "Existing 3D HUD runtime script will be updated to the bundled payload version",
      "Update 3D HUD script"
    ));
  }

  if (hudConflicts.length > 0) {
    const existingHud = nextExistingFileByPath.get(HUD_LAYOUT_PATH);
    if (!existingHud) {
      blockedConflicts.push(annotateConflict(
        hudConflicts[0],
        "Existing hud.vxml_c entry was not found after conflict detection"
      ));
    } else {
      try {
        const { source } = decompilePanoramaLayoutResource(existingHud.bytes);
        const patchedSource = patchHudLayoutSource(source, options.hudProbeSource);
        const patchedBytes = compilePanoramaLayoutResource(patchedSource);
        nextExistingFiles = replaceFileBytes(nextExistingFiles, HUD_LAYOUT_PATH, patchedBytes);
        nextExistingFileByPath = createFileMap(nextExistingFiles);
        patchedPaths.push(HUD_LAYOUT_PATH);
        resolvedConflicts.push(...annotateConflicts(
          hudConflicts,
          "Existing HUD layout can be decompiled, patched, and recompiled",
          "Patch existing layout"
        ));
      } catch (error) {
        blockedConflicts.push(...annotateConflicts(
          hudConflicts,
          `Cannot decompile existing hud.vxml_c: ${error?.message || String(error)}`
        ));
      }
    }
  }

  if (hudHealthConflicts.length > 0) {
    const existingHudHealth = nextExistingFileByPath.get(HUD_HEALTH_LAYOUT_PATH);
    const payloadHudHealth = payloadFileByPath.get(HUD_HEALTH_LAYOUT_PATH);
    if (!existingHudHealth || !payloadHudHealth) {
      blockedConflicts.push(annotateConflict(
        hudHealthConflicts[0],
        "Existing or payload hud_health.vxml_c entry was not found after conflict detection"
      ));
    } else {
      try {
        const existingSource = decompilePanoramaLayoutResource(existingHudHealth.bytes).source;
        const payloadSource = decompilePanoramaLayoutResource(payloadHudHealth.bytes).source;
        const patchedSource = patchHudHealthLayoutSource(existingSource, payloadSource);
        const patchedBytes = compilePanoramaLayoutResource(patchedSource);
        nextExistingFiles = replaceFileBytes(nextExistingFiles, HUD_HEALTH_LAYOUT_PATH, patchedBytes);
        nextExistingFileByPath = createFileMap(nextExistingFiles);
        patchedPaths.push(HUD_HEALTH_LAYOUT_PATH);
        resolvedConflicts.push(...annotateConflicts(
          hudHealthConflicts,
          "Existing health layout can be decompiled, kept with user scripts, and patched with the 3D HUD health body",
          "Patch existing health layout"
        ));
      } catch (error) {
        blockedConflicts.push(...annotateConflicts(
          hudHealthConflicts,
          `Cannot patch existing hud_health.vxml_c: ${error?.message || String(error)}`
        ));
      }
    }
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
