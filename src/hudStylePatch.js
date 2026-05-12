function normalizeCssForCompare(source) {
  return String(source || "").replace(/\s+/g, "");
}

const CSS_IMPORT_PATTERN = /@import\s+url\(\s*["'][^"']+["']\s*\)\s*;/gi;
const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

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

function withoutComments(sourceText) {
  return String(sourceText || "").replace(CSS_COMMENT_PATTERN, "");
}

function normalizeSelector(selector) {
  return String(selector || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelCss(sourceText) {
  const source = withoutComments(sourceText);
  const nodes = [];
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) break;

    const start = index;
    let braceIndex = -1;
    let semicolonIndex = -1;
    while (index < source.length) {
      const char = source[index];
      if (char === "{") {
        braceIndex = index;
        break;
      }
      if (char === ";") {
        semicolonIndex = index;
        break;
      }
      index += 1;
    }

    if (braceIndex >= 0) {
      const end = findMatchingBrace(source, braceIndex);
      if (end < 0) {
        nodes.push({
          type: "statement",
          text: source.slice(start).trim()
        });
        break;
      }
      const selector = source.slice(start, braceIndex).trim();
      const body = source.slice(braceIndex + 1, end).trim();
      nodes.push({
        type: "block",
        selector,
        body,
        text: source.slice(start, end + 1).trim()
      });
      index = end + 1;
      continue;
    }

    if (semicolonIndex >= 0) {
      nodes.push({
        type: "statement",
        text: source.slice(start, semicolonIndex + 1).trim()
      });
      index = semicolonIndex + 1;
      continue;
    }

    const text = source.slice(start).trim();
    if (text) nodes.push({ type: "statement", text });
    break;
  }

  return nodes.filter((node) => node.text);
}

function parseDeclarations(blockBody) {
  if (String(blockBody || "").includes("{")) return null;

  const declarations = [];
  for (const rawDeclaration of String(blockBody || "").split(";")) {
    const declaration = rawDeclaration.trim();
    if (!declaration) continue;
    const parts = declaration.match(/^([^:]+):([\s\S]+)$/);
    if (!parts) return null;
    const property = parts[1].trim();
    const value = parts[2].trim();
    if (!property || !value) return null;
    declarations.push({
      property,
      key: property.toLowerCase(),
      value,
      normalizedValue: normalizeCssForCompare(value).toLowerCase()
    });
  }

  return declarations;
}

function declarationMap(blockBody) {
  const declarations = parseDeclarations(blockBody);
  if (!declarations) return null;
  const byProperty = new Map();
  for (const declaration of declarations) {
    byProperty.set(declaration.key, declaration.normalizedValue);
  }
  return byProperty;
}

function diffBlockAgainstBase(block, baseBlock) {
  if (!baseBlock || normalizeCssForCompare(block.body) === normalizeCssForCompare(baseBlock.body)) {
    return [];
  }

  const overrideDeclarations = parseDeclarations(block.body);
  const baseDeclarations = declarationMap(baseBlock.body);
  if (!overrideDeclarations || !baseDeclarations) {
    return null;
  }

  return overrideDeclarations.filter((declaration) => (
    baseDeclarations.get(declaration.key) !== declaration.normalizedValue
  ));
}

function formatBlock(selector, declarations) {
  const body = declarations
    .map((declaration) => `\t${declaration.property}: ${declaration.value};`)
    .join("\n");
  return `${selector}\n{\n${body}\n}`;
}

function indexBaseBlocks(baseNodes) {
  const blocks = new Map();
  for (const node of baseNodes) {
    if (node.type !== "block") continue;
    blocks.set(normalizeSelector(node.selector), node);
  }
  return blocks;
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

export function createCssDeltaSource(baseSourceText, overrideSourceText) {
  const baseNodes = splitTopLevelCss(baseSourceText);
  const overrideNodes = splitTopLevelCss(overrideSourceText);
  const baseBlocks = indexBaseBlocks(baseNodes);
  const baseStatements = new Set();
  for (const node of baseNodes) {
    if (node.type === "statement") {
      baseStatements.add(normalizeCssForCompare(node.text).toLowerCase());
    }
  }
  const output = [];

  for (const node of overrideNodes) {
    if (node.type === "statement") {
      if (!baseStatements.has(normalizeCssForCompare(node.text).toLowerCase())) {
        output.push(node.text);
      }
      continue;
    }

    const baseBlock = baseBlocks.get(normalizeSelector(node.selector));
    if (!baseBlock) {
      output.push(node.text);
      continue;
    }

    const changedDeclarations = diffBlockAgainstBase(node, baseBlock);
    if (changedDeclarations === null) {
      if (normalizeCssForCompare(node.text) !== normalizeCssForCompare(baseBlock.text)) {
        output.push(node.text);
      }
      continue;
    }
    if (changedDeclarations.length > 0) {
      output.push(formatBlock(node.selector, changedDeclarations));
    }
  }

  return output.join("\n\n").trim();
}

export function createCssHijackSource(baseImport, overrideSourceText, baseSourceText = "") {
  const overrideSource = baseSourceText
    ? createCssDeltaSource(baseSourceText, overrideSourceText)
    : overrideSourceText;
  const source = combineCssSources(baseImport, overrideSource);
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
