const HUD_STYLE_INCLUDE = '<include src="s2r://panorama/styles/3d_hud.vcss_c" />';
const HUD_SCRIPT_INCLUDE = '<include src="s2r://panorama/scripts/3d_hero_dynamic.vjs_c" />';
const HUD_PROBE_ID = "ThreeDHeroHudProbe";
const ANITA_PERSIST_LOADER_INCLUDE = /[ \t]*<include\b(?=[^>]*\bsrc\s*=\s*["']s2r:\/\/panorama\/scripts\/anita_persist_loader\.vjs_c["'])[^>]*\/>[ \t]*(?:\r?\n)?/gi;

function includesIgnoreCase(source, needle) {
  return String(source).toLowerCase().includes(String(needle).toLowerCase());
}

function insertAfterRootOpen(source, insertion) {
  const rootMatch = source.match(/<root\b[^>]*>/i);
  if (!rootMatch || rootMatch.index === undefined) {
    throw new Error("HUD layout XML is missing a root element");
  }
  const insertAt = rootMatch.index + rootMatch[0].length;
  return `${source.slice(0, insertAt)}\n${insertion}${source.slice(insertAt)}`;
}

function ensureStyleInclude(source) {
  if (includesIgnoreCase(source, "s2r://panorama/styles/3d_hud.vcss_c")) {
    return source;
  }

  const closeStyles = source.search(/<\/styles>/i);
  if (closeStyles >= 0) {
    return `${source.slice(0, closeStyles)}\t\t${HUD_STYLE_INCLUDE}\n${source.slice(closeStyles)}`;
  }

  return insertAfterRootOpen(source, `\t<styles>\n\t\t${HUD_STYLE_INCLUDE}\n\t</styles>`);
}

function ensureScriptInclude(source) {
  if (includesIgnoreCase(source, "s2r://panorama/scripts/3d_hero_dynamic.vjs_c")) {
    return source;
  }

  const closeScripts = source.search(/<\/scripts>/i);
  if (closeScripts >= 0) {
    return `${source.slice(0, closeScripts)}\t\t${HUD_SCRIPT_INCLUDE}\n${source.slice(closeScripts)}`;
  }

  const closeStylesMatch = source.match(/<\/styles>/i);
  if (closeStylesMatch && closeStylesMatch.index !== undefined) {
    const insertAt = closeStylesMatch.index + closeStylesMatch[0].length;
    return `${source.slice(0, insertAt)}\n\t<scripts>\n\t\t${HUD_SCRIPT_INCLUDE}\n\t</scripts>${source.slice(insertAt)}`;
  }

  return insertAfterRootOpen(source, `\t<scripts>\n\t\t${HUD_SCRIPT_INCLUDE}\n\t</scripts>`);
}

function removeTemporaryAnitaPersistLoader(source) {
  return source
    .replace(ANITA_PERSIST_LOADER_INCLUDE, "")
    .replace(/[ \t]*<scripts\b[^>]*>\s*<\/scripts>[ \t]*(?:\r?\n)?/gi, "");
}

function findProbePanelBlock(source) {
  const openPattern = new RegExp(`<Panel\\b(?=[^>]*\\bid\\s*=\\s*["']${HUD_PROBE_ID}["'])[^>]*>`, "i");
  const openMatch = source.match(openPattern);
  if (!openMatch || openMatch.index === undefined) return null;

  const start = openMatch.index;
  if (/\/\s*>$/.test(openMatch[0])) {
    return { start, end: start + openMatch[0].length, block: openMatch[0] };
  }

  const panelTagPattern = /<\/?Panel\b[^>]*>/gi;
  panelTagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = panelTagPattern.exec(source))) {
    const tag = match[0];
    const isClosing = /^<\//.test(tag);
    const isSelfClosing = /\/\s*>$/.test(tag);
    if (!isClosing && !isSelfClosing) depth += 1;
    if (isClosing) depth -= 1;
    if (depth === 0) {
      const end = panelTagPattern.lastIndex;
      return { start, end, block: source.slice(start, end) };
    }
  }

  throw new Error("Existing ThreeDHeroHudProbe panel is malformed");
}

function ensureProbePanel(source, hudProbeSource) {
  const closeCitadelHud = source.search(/<\/CitadelHud>/i);
  if (closeCitadelHud < 0) {
    throw new Error("HUD layout XML is missing the CitadelHud close tag");
  }

  const existingProbe = findProbePanelBlock(source);
  let snippet = existingProbe ? existingProbe.block.trim() : String(hudProbeSource || "").trim();
  if (!snippet || !new RegExp(`id\\s*=\\s*["']${HUD_PROBE_ID}["']`, "i").test(snippet)) {
    throw new Error("3D HUD probe snippet is missing ThreeDHeroHudProbe");
  }

  if (existingProbe) {
    source = `${source.slice(0, existingProbe.start)}${source.slice(existingProbe.end)}`;
  }

  const formattedSnippet = `\n\t\t\t${snippet.replace(/\r?\n/g, "\n\t\t\t")}`;
  const heroTestingPattern = /<CitadelHudHeroTesting\b(?=[^>]*\bid\s*=\s*["']hud_hero_testing["'])[^>]*\/?>/i;
  const heroTestingMatch = source.match(heroTestingPattern);
  if (heroTestingMatch && heroTestingMatch.index !== undefined) {
    const insertAt = heroTestingMatch.index + heroTestingMatch[0].length;
    return `${source.slice(0, insertAt)}${formattedSnippet}${source.slice(insertAt)}`;
  }

  return `${source.slice(0, closeCitadelHud)}${formattedSnippet}\n${source.slice(closeCitadelHud)}`;
}

export function patchHudLayoutSource(sourceText, hudProbeSource) {
  let source = String(sourceText || "");
  source = ensureStyleInclude(source);
  source = removeTemporaryAnitaPersistLoader(source);
  source = ensureScriptInclude(source);
  source = ensureProbePanel(source, hudProbeSource);
  return source;
}
