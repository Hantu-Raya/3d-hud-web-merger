function normalizeCssForCompare(source) {
  return String(source || "").replace(/\s+/g, "");
}

const CSS_IMPORT_PATTERN = /@import\s+url\(\s*["'][^"']+["']\s*\)\s*;/gi;

function uniqueLines(lines) {
  const seen = new Set();
  const unique = [];
  for (const line of lines) {
    const key = line.replace(/\s+/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique;
}

function splitCssImports(sourceText) {
  const source = String(sourceText || "");
  const imports = [];
  const body = source.replace(CSS_IMPORT_PATTERN, (match) => {
    imports.push(match.trim());
    return "";
  }).trim();
  return { imports, body };
}

function combineCssSources(...sources) {
  const imports = [];
  const bodies = [];

  for (const sourceText of sources) {
    const { imports: sourceImports, body } = splitCssImports(sourceText);
    imports.push(...sourceImports);
    if (body) bodies.push(body);
  }

  return [...uniqueLines(imports), ...bodies].join("\n\n").trim();
}

export function createCssHijackSource(baseImport, overrideSourceText) {
  const source = combineCssSources(baseImport, overrideSourceText);
  if (!source) {
    throw new Error("CSS hijack source is empty");
  }
  return `${source}\n`;
}

export function patchHudStyleSource(existingSourceText, payloadSourceText) {
  const existingSource = String(existingSourceText || "");
  const payloadSource = String(payloadSourceText || "").trim();
  if (!payloadSource) {
    throw new Error("Payload CSS is empty");
  }

  if (normalizeCssForCompare(existingSource).includes(normalizeCssForCompare(payloadSource))) {
    return existingSource;
  }

  return `${combineCssSources(existingSource, payloadSource)}\n`;
}
