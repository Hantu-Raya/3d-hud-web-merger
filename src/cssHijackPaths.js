import { normalizeVpkPath } from "./vpkMerge.js";

export const CSS_HIJACK_STYLE_PATHS = [
  "panorama/styles/citadel_status_effect.vcss_c",
  "panorama/styles/hud_health.vcss_c",
  "panorama/styles/hud_health_container.vcss_c",
  "panorama/styles/unit_status_icons.vcss_c"
];

const CSS_HIJACK_BASE_PREFIX = "panorama/styles/base/";

const CSS_HIJACK_STYLE_SET = new Set(CSS_HIJACK_STYLE_PATHS.map(normalizeVpkPath));
const CSS_HIJACK_BASE_PATHS = new Map(CSS_HIJACK_STYLE_PATHS.map((compiledPath) => {
  const normalized = normalizeVpkPath(compiledPath);
  return [normalized, `${CSS_HIJACK_BASE_PREFIX}${normalized.split("/").pop()}`];
}));
const CSS_HIJACK_BASE_SET = new Set([...CSS_HIJACK_BASE_PATHS.values()].map(normalizeVpkPath));

export function isCssHijackStylePath(path) {
  return CSS_HIJACK_STYLE_SET.has(normalizeVpkPath(path));
}

export function cssHijackBasePathFor(path) {
  return CSS_HIJACK_BASE_PATHS.get(normalizeVpkPath(path)) || "";
}

export function isCssHijackBasePath(path) {
  return CSS_HIJACK_BASE_SET.has(normalizeVpkPath(path));
}

export function hasCssHijackBaseFolder(files) {
  return (files || []).some((file) => normalizeVpkPath(file.path).startsWith(CSS_HIJACK_BASE_PREFIX));
}

export function cssHijackBaseImportFor(path) {
  const basePath = cssHijackBasePathFor(path);
  if (!basePath) return "";
  return `@import url("s2r://${basePath}");`;
}
