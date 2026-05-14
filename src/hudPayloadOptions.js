import { crc32 } from "./crc32.js";
import { normalizeVpkPath } from "./vpkMerge.js";

export const MIN_HUD_UI_SCALE = 120;
export const MAX_HUD_UI_SCALE = 170;
export const DEFAULT_HUD_UI_SCALE = 170;
export const HUD_UI_SCALE_PATCHED_PATHS = [
  "panorama/styles/3d_hud.vcss_c",
  "panorama/styles/hud_health_container.vcss_c"
];

const DEFAULT_HEALTH_REGEN_MARGIN_RIGHT = 20;
const RECENT_COUNTER_STACK_HEIGHT = 96;
const RECENT_COUNTER_MARGIN_TOP = -36;
const RECENT_HEAL_MARGIN_RIGHT = 86;
const RECENT_DAMAGE_MARGIN_RIGHT = -158;
const HUD_UI_SCALE_PATCHED_PATH_SET = new Set(HUD_UI_SCALE_PATCHED_PATHS.map(normalizeVpkPath));

function cloneBytes(bytes) {
  return bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
}

function crc32Hex(bytes) {
  return crc32(bytes).toString(16).padStart(8, "0");
}

function addSignature(signaturesByPath, path, signature) {
  const normalizedPath = normalizeVpkPath(path);
  if (!HUD_UI_SCALE_PATCHED_PATH_SET.has(normalizedPath) || !signature) return;
  const key = fileSignatureKey(signature);
  if (!key) return;
  if (!signaturesByPath.has(normalizedPath)) {
    signaturesByPath.set(normalizedPath, new Set());
  }
  signaturesByPath.get(normalizedPath).add(key);
}

function signatureFromManifestEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!Number.isFinite(Number(entry.size)) || !entry.crc32) return null;
  return {
    size: Number(entry.size),
    crc32: String(entry.crc32)
  };
}

export function normalizeHudUiScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HUD_UI_SCALE;
  return Math.max(MIN_HUD_UI_SCALE, Math.min(MAX_HUD_UI_SCALE, Math.round(numeric)));
}

export function isHudUiScaleOwnedPath(path) {
  return HUD_UI_SCALE_PATCHED_PATH_SET.has(normalizeVpkPath(path));
}

export function createFileSignature(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    size: data.byteLength,
    crc32: crc32Hex(data)
  };
}

export function fileSignatureKey(signature) {
  if (!signature || !Number.isFinite(Number(signature.size)) || !signature.crc32) return "";
  return `${Number(signature.size)}:${String(signature.crc32).toLowerCase().padStart(8, "0")}`;
}

export function buildHudUiScaleKnownSignatures(manifest, payloadFiles) {
  const signaturesByPath = new Map();
  for (const file of payloadFiles || []) {
    if (isHudUiScaleOwnedPath(file.path)) {
      addSignature(signaturesByPath, file.path, createFileSignature(file.bytes));
    }
  }

  const scaleOptions = manifest?.scaleOptions?.hudUiScale;
  for (const [path, signature] of Object.entries(scaleOptions?.defaultSignatures || {})) {
    addSignature(signaturesByPath, path, signatureFromManifestEntry(signature));
  }

  for (const variant of Object.values(scaleOptions?.variants || {})) {
    for (const [path, entry] of Object.entries(variant || {})) {
      addSignature(signaturesByPath, path, signatureFromManifestEntry(entry));
    }
  }

  return signaturesByPath;
}

export function applyHudUiScalePayloadFiles(payloadFiles, variantFilesByPath = new Map()) {
  const replacements = new Map();
  for (const [path, bytes] of variantFilesByPath || []) {
    const normalizedPath = normalizeVpkPath(path);
    if (HUD_UI_SCALE_PATCHED_PATH_SET.has(normalizedPath)) {
      replacements.set(normalizedPath, cloneBytes(bytes));
    }
  }

  return (payloadFiles || []).map((file) => {
    const normalizedPath = normalizeVpkPath(file.path);
    return {
      path: String(file.path),
      bytes: replacements.has(normalizedPath) ? cloneBytes(replacements.get(normalizedPath)) : cloneBytes(file.bytes)
    };
  });
}

function setDeclaration(blockBody, property, value) {
  const declaration = `  ${property}: ${value};`;
  const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[;\\n])\\s*${propertyPattern}\\s*:\\s*[^;]+;`, "ig");
  if (pattern.test(blockBody)) {
    let replaced = false;
    pattern.lastIndex = 0;
    return blockBody.replace(pattern, (match, prefix) => {
      if (replaced) return prefix;
      replaced = true;
      const separator = prefix === ";" ? ";\n" : prefix;
      return `${separator}${declaration}`;
    });
  }

  const trimmed = blockBody.trimEnd();
  return `${trimmed}${trimmed ? "\n" : ""}${declaration}\n`;
}

function setBlockDeclarations(sourceText, blockPattern, selectorText, declarations) {
  const source = String(sourceText || "");
  const pattern = new RegExp(`(${blockPattern}\\s*\\{)([\\s\\S]*?)(\\})`, "i");
  const match = source.match(pattern);
  if (!match) {
    const body = Object.entries(declarations)
      .map(([property, value]) => `  ${property}: ${value};`)
      .join("\n");
    const separator = source.endsWith("\n") || source.length === 0 ? "" : "\n";
    return `${source}${separator}\n${selectorText} {\n${body}\n}\n`;
  }

  let nextBody = match[2];
  for (const [property, value] of Object.entries(declarations)) {
    nextBody = setDeclaration(nextBody, property, value);
  }

  return source.replace(pattern, `${match[1]}${nextBody}${match[3]}`);
}

function px(value) {
  return `${Math.round(value)}px`;
}

function scaledFromDefault(value, scale) {
  return px(value * (scale / DEFAULT_HUD_UI_SCALE));
}

function healthContainerScaleDeclarations(scale) {
  const ratio = scale / DEFAULT_HUD_UI_SCALE;
  return {
    container: {
      "ui-scale": `${scale}%`,
      width: "350px",
      height: "380px",
      "vertical-align": "bottom"
    },
    aspect16x10: {
      "horizontal-align": "center",
      "margin-right": px(1030 * ratio),
      "margin-left": px(130 * ratio),
      "margin-bottom": px(-130 * ratio)
    }
  };
}

export function patchHudScaleStyleSource(sourceText, hudUiScale) {
  const scale = normalizeHudUiScale(hudUiScale);
  const declarations = healthContainerScaleDeclarations(scale);
  let source = setBlockDeclarations(
    sourceText,
    "#health_and_abilities_container",
    "#health_and_abilities_container",
    declarations.container
  );
  source = setBlockDeclarations(
    source,
    "\\.AspectRatio16x10\\s+#health_and_abilities_container",
    ".AspectRatio16x10 #health_and_abilities_container",
    declarations.aspect16x10
  );
  return source;
}

export function patchHudHealthContainerStyleSource(sourceText, hudUiScale = DEFAULT_HUD_UI_SCALE) {
  const scale = normalizeHudUiScale(hudUiScale);
  let source = setBlockDeclarations(
    sourceText,
    "#HealthRegenAndTotal",
    "#HealthRegenAndTotal",
    { "margin-right": scaledFromDefault(DEFAULT_HEALTH_REGEN_MARGIN_RIGHT, scale) }
  );
  source = setBlockDeclarations(
    source,
    "#RecentHealContainer\\s*,\\s*\\.recentHealCounters",
    "#RecentHealContainer,\n.recentHealCounters",
    {
      "horizontal-align": "middle",
      "margin-right": scaledFromDefault(RECENT_HEAL_MARGIN_RIGHT, scale),
      "margin-top": scaledFromDefault(RECENT_COUNTER_MARGIN_TOP, scale),
      height: px(RECENT_COUNTER_STACK_HEIGHT)
    }
  );
  source = setBlockDeclarations(
    source,
    "#RecentDamageContainer\\s*,\\s*\\.recentDamageCounters",
    "#RecentDamageContainer,\n.recentDamageCounters",
    {
      "horizontal-align": "middle",
      "margin-right": scaledFromDefault(RECENT_DAMAGE_MARGIN_RIGHT, scale),
      "margin-top": scaledFromDefault(RECENT_COUNTER_MARGIN_TOP, scale),
      height: px(RECENT_COUNTER_STACK_HEIGHT)
    }
  );
  return source;
}

export function patchStatusEffectStyleSource(sourceText) {
  return setBlockDeclarations(
    sourceText,
    "CitadelHud\\s+CitadelStatusEffect",
    "CitadelHud CitadelStatusEffect",
    { "margin-left": "0px" }
  );
}

export function requiresCompilerForHudUiScale(value) {
  return normalizeHudUiScale(value) !== DEFAULT_HUD_UI_SCALE;
}
