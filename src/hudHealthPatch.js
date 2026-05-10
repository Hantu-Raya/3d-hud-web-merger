const BARS_CONTAINER_CLASS = "bars_container";

function findPanelBlockByClass(source, className) {
  const panelPattern = /<Panel\b[^>]*>/gi;
  let match;

  while ((match = panelPattern.exec(source))) {
    const tag = match[0];
    const classMatch = tag.match(/\bclass\s*=\s*["']([^"']*)["']/i);
    if (!classMatch) continue;

    const classes = new Set(classMatch[1].split(/\s+/).filter(Boolean));
    if (!classes.has(className)) continue;

    const start = match.index;
    if (/\/\s*>$/.test(tag)) {
      return { start, end: start + tag.length, block: tag };
    }

    const nestedPanelPattern = /<\/?Panel\b[^>]*>/gi;
    nestedPanelPattern.lastIndex = start;
    let depth = 0;
    let nestedMatch;
    while ((nestedMatch = nestedPanelPattern.exec(source))) {
      const nestedTag = nestedMatch[0];
      const isClosing = /^<\//.test(nestedTag);
      const isSelfClosing = /\/\s*>$/.test(nestedTag);
      if (!isClosing && !isSelfClosing) depth += 1;
      if (isClosing) depth -= 1;
      if (depth === 0) {
        const end = nestedPanelPattern.lastIndex;
        return { start, end, block: source.slice(start, end) };
      }
    }

    throw new Error(`${className} panel is malformed`);
  }

  return null;
}

export function patchHudHealthLayoutSource(existingSourceText, payloadSourceText) {
  const existingSource = String(existingSourceText || "");
  const payloadSource = String(payloadSourceText || "");
  const existingBars = findPanelBlockByClass(existingSource, BARS_CONTAINER_CLASS);
  const payloadBars = findPanelBlockByClass(payloadSource, BARS_CONTAINER_CLASS);

  if (!existingBars) {
    throw new Error("Existing hud_health layout is missing bars_container");
  }
  if (!payloadBars) {
    throw new Error("Payload hud_health layout is missing bars_container");
  }

  return `${existingSource.slice(0, existingBars.start)}${payloadBars.block.trim()}${existingSource.slice(existingBars.end)}`;
}
