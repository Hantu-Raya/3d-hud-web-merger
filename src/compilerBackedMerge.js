import { patchHudHealthLayoutSource } from "./hudHealthPatch.js";
import { patchHudLayoutSource } from "./hudLayoutPatch.js";
import { patchHudHealthContainerStyleSource } from "./hudPayloadOptions.js";
import { patchHudStyleSource } from "./hudStylePatch.js";
import { isCssHijackBasePath } from "./cssHijackPaths.js";
import { decompilePanoramaLayoutResource } from "./source2ResourceReader.js";
import { decompileTextResource } from "./source2TextResource.js";
import { createMergedFiles, findPathConflicts, normalizeVpkPath } from "./vpkMerge.js";

const HUD_LAYOUT_PATH = "panorama/layout/hud.vxml_c";
const HUD_HEALTH_LAYOUT_PATH = "panorama/layout/hud_health.vxml_c";
const HUD_HEALTH_CONTAINER_LAYOUT_PATH = "panorama/layout/hud_health_container.vxml_c";
const HUD_HEALTH_CONTAINER_STYLE_PATH = "panorama/styles/hud_health_container.vcss_c";
const HUD_DYNAMIC_SCRIPT_PATH = "panorama/scripts/3d_hero_dynamic.vjs_c";

const SOURCE_PATH_BY_COMPILED_PATH = new Map([
  [HUD_LAYOUT_PATH, "panorama/layout/hud.xml"],
  [HUD_HEALTH_LAYOUT_PATH, "panorama/layout/hud_health.xml"],
  ["panorama/styles/3d_hud.vcss_c", "panorama/styles/3d_hud.css"],
  ["panorama/styles/citadel_status_effect.vcss_c", "panorama/styles/citadel_status_effect.css"],
  ["panorama/styles/hud_health.vcss_c", "panorama/styles/hud_health.css"],
  ["panorama/styles/hud_health_container.vcss_c", "panorama/styles/hud_health_container.css"],
  ["panorama/styles/unit_status_icons.vcss_c", "panorama/styles/unit_status_icons.css"]
]);

function cloneBytes(bytes) {
  return bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
}

function cloneFile(file) {
  return { path: String(file.path), bytes: cloneBytes(file.bytes) };
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

function findByNormalizedPath(files, path) {
  const normalized = normalizeVpkPath(path);
  return (files || []).find((file) => normalizeVpkPath(file.path) === normalized);
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

function replaceFileBytes(files, path, bytes) {
  const normalized = normalizeVpkPath(path);
  return files.map((file) => (
    normalizeVpkPath(file.path) === normalized ? { path: normalized, bytes: cloneBytes(bytes) } : cloneFile(file)
  ));
}

function isPatchableStyle(path) {
  const normalized = normalizeVpkPath(path);
  return normalized.endsWith(".vcss_c") && SOURCE_PATH_BY_COMPILED_PATH.has(normalized);
}

function sourcePathForCompiledPath(path) {
  const normalized = normalizeVpkPath(path);
  const sourcePath = SOURCE_PATH_BY_COMPILED_PATH.get(normalized);
  if (!sourcePath) {
    throw new Error(`No source path mapping exists for ${path}`);
  }
  return sourcePath;
}

function createSourcePatch(compiledPath, source) {
  const normalized = normalizeVpkPath(compiledPath);
  return {
    compiledPath: normalized,
    sourcePath: sourcePathForCompiledPath(normalized),
    source: String(source)
  };
}

function identicalConflictSet(conflicts, existingFileByPath, payloadFileByPath) {
  const identical = new Set();
  for (const conflict of conflicts) {
    const normalizedPath = normalizeVpkPath(conflict.path);
    const existingFile = existingFileByPath.get(normalizedPath);
    const payloadFile = payloadFileByPath.get(normalizedPath);
    if (existingFile && payloadFile && bytesEqual(existingFile.bytes, payloadFile.bytes)) {
      identical.add(normalizedPath);
    }
  }
  return identical;
}

export function createCompilerBackedHudMergePlan(existingFiles, payloadFiles, options = {}) {
  const conflicts = findPathConflicts(existingFiles, payloadFiles);
  const existingFileByPath = createFileMap(existingFiles);
  const payloadFileByPath = createFileMap(payloadFiles);
  const identicalPaths = identicalConflictSet(conflicts, existingFileByPath, payloadFileByPath);
  const activeConflicts = [];
  const alreadyPresentConflicts = [];

  for (const conflict of conflicts) {
    if (identicalPaths.has(normalizeVpkPath(conflict.path))) {
      alreadyPresentConflicts.push(annotateConflict(
        conflict,
        "Payload file is already present with identical bytes",
        "Keep existing file"
      ));
    } else {
      activeConflicts.push(conflict);
    }
  }

  const nextExistingFiles = (existingFiles || []).map(cloneFile);
  const nextExistingFileByPath = createFileMap(nextExistingFiles);
  const sourcePatches = [];
  const patchedPaths = [];
  const resolvedConflicts = [];
  const blockedConflicts = [];
  const keptPayloadPaths = new Set(identicalPaths);

  for (const conflict of activeConflicts) {
    const path = normalizeVpkPath(conflict.path);
    const existingFile = nextExistingFileByPath.get(path);
    const payloadFile = payloadFileByPath.get(path);

    if (!existingFile || !payloadFile) {
      blockedConflicts.push(annotateConflict(
        conflict,
        "Existing or payload entry was not found after conflict detection"
      ));
      continue;
    }

    try {
      if (path === HUD_LAYOUT_PATH) {
        const source = decompilePanoramaLayoutResource(existingFile.bytes).source;
        sourcePatches.push(createSourcePatch(path, patchHudLayoutSource(source, options.hudProbeSource)));
        patchedPaths.push(path);
        keptPayloadPaths.add(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing HUD layout will be patched as XML and recompiled with the Source 2 compiler",
          "Compiler patch layout"
        ));
        continue;
      }

      if (path === HUD_HEALTH_LAYOUT_PATH) {
        const existingSource = decompilePanoramaLayoutResource(existingFile.bytes).source;
        const payloadSource = decompilePanoramaLayoutResource(payloadFile.bytes).source;
        sourcePatches.push(createSourcePatch(path, patchHudHealthLayoutSource(existingSource, payloadSource)));
        patchedPaths.push(path);
        keptPayloadPaths.add(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing health layout will keep user wrapper content and receive the 3D HUD health body, then be recompiled",
          "Compiler patch health layout"
        ));
        continue;
      }

      if (path === HUD_HEALTH_CONTAINER_LAYOUT_PATH) {
        keptPayloadPaths.add(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing health container layout already satisfies the path the HUD needs",
          "Keep existing layout"
        ));
        continue;
      }

      if (path === HUD_DYNAMIC_SCRIPT_PATH) {
        nextExistingFileByPath.set(path, payloadFile);
        for (let index = 0; index < nextExistingFiles.length; index += 1) {
          if (normalizeVpkPath(nextExistingFiles[index].path) === path) {
            nextExistingFiles[index] = cloneFile(payloadFile);
            break;
          }
        }
        keptPayloadPaths.add(path);
        patchedPaths.push(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing 3D HUD runtime script will be updated to the bundled payload version",
          "Update 3D HUD script"
        ));
        continue;
      }

      if (isCssHijackBasePath(path)) {
        nextExistingFileByPath.set(path, payloadFile);
        for (let index = 0; index < nextExistingFiles.length; index += 1) {
          if (normalizeVpkPath(nextExistingFiles[index].path) === path) {
            nextExistingFiles[index] = cloneFile(payloadFile);
            break;
          }
        }
        keptPayloadPaths.add(path);
        patchedPaths.push(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing base CSS will be updated to the bundled SteamTracking version",
          "Update SteamTracking base CSS"
        ));
        continue;
      }

      if (isPatchableStyle(path)) {
        const existingSource = decompileTextResource(existingFile.bytes, { panoramaPrelude: true }).source;
        const payloadSource = decompileTextResource(payloadFile.bytes, { panoramaPrelude: true }).source;
        let patchedSource = patchHudStyleSource(existingSource, payloadSource);
        if (path === HUD_HEALTH_CONTAINER_STYLE_PATH) {
          patchedSource = patchHudHealthContainerStyleSource(patchedSource, options.hudUiScale);
        }
        sourcePatches.push(createSourcePatch(path, patchedSource));
        patchedPaths.push(path);
        keptPayloadPaths.add(path);
        resolvedConflicts.push(annotateConflict(
          conflict,
          "Existing CSS will be preserved, extended with the 3D HUD CSS, and recompiled",
          "Compiler patch style"
        ));
        continue;
      }

      blockedConflicts.push(annotateConflict(
        conflict,
        "This compiled path has no safe patch rule yet"
      ));
    } catch (error) {
      blockedConflicts.push(annotateConflict(
        conflict,
        `Cannot prepare compiler-backed patch: ${error?.message || String(error)}`
      ));
    }
  }

  if (blockedConflicts.length > 0) {
    return {
      files: null,
      conflicts: [...resolvedConflicts, ...alreadyPresentConflicts, ...blockedConflicts],
      blockedConflicts,
      patchedPaths,
      sourcePatches
    };
  }

  const payloadToAdd = [];
  for (const file of payloadFiles || []) {
    if (!keptPayloadPaths.has(normalizeVpkPath(file.path))) {
      payloadToAdd.push(cloneFile(file));
    }
  }

  return {
    files: createMergedFiles(nextExistingFiles, payloadToAdd),
    conflicts: [...resolvedConflicts, ...alreadyPresentConflicts],
    blockedConflicts: [],
    patchedPaths,
    sourcePatches
  };
}

export function finalizeCompilerBackedHudMerge(plan, compiledFiles) {
  if (!plan || !Array.isArray(plan.files)) {
    throw new Error("Cannot finalize a blocked compiler-backed merge plan");
  }

  let files = plan.files.map(cloneFile);
  for (const sourcePatch of plan.sourcePatches || []) {
    const compiledFile = findByNormalizedPath(compiledFiles, sourcePatch.compiledPath);
    if (!compiledFile) {
      throw new Error(`Compiler did not emit ${sourcePatch.compiledPath}`);
    }
    files = replaceFileBytes(files, sourcePatch.compiledPath, compiledFile.bytes);
  }
  return files;
}
