function isKvObject(value) {
  return value && typeof value === "object" && value.kind === "object";
}

function isKvArray(value) {
  return value && typeof value === "object" && value.kind === "array";
}

function getProperty(object, key) {
  if (!isKvObject(object)) return undefined;
  return object.entries.find((entry) => entry.key === key)?.value;
}

function getStringProperty(object, key) {
  const value = getProperty(object, key);
  return value == null ? "" : String(value);
}

function getSubCollection(object, key) {
  const value = getProperty(object, key);
  return isKvObject(value) ? value : null;
}

function getArray(object, key) {
  const value = getProperty(object, key);
  return isKvArray(value) ? value.items : [];
}

function hasProperty(object, key) {
  return isKvObject(object) && object.entries.some((entry) => entry.key === key);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function indent(level) {
  return "\t".repeat(level);
}

function subNodes(node) {
  if (hasProperty(node, "vecChildren")) {
    return getArray(node, "vecChildren");
  }
  const child = getSubCollection(node, "child");
  return child ? [child] : [];
}

function isAttribute(node) {
  return getStringProperty(node, "eType") === "PANEL_ATTRIBUTE";
}

function nodeAttributes(node) {
  return subNodes(node).filter((child) => isKvObject(child) && isAttribute(child));
}

function nodeChildren(node) {
  return subNodes(node).filter((child) => isKvObject(child) && !isAttribute(child));
}

function printAttributeOrReferenceValue(node) {
  const value = getStringProperty(node, "name");
  const type = getStringProperty(node, "eType");

  if (type === "REFERENCE_COMPILED") return `"s2r://${escapeAttribute(value)}"`;
  if (type === "REFERENCE_PASSTHROUGH") return `"file://${escapeAttribute(value)}"`;
  if (type === "PANEL_ATTRIBUTE_VALUE") return `"${escapeAttribute(value)}"`;
  throw new Error(`Unknown Panorama layout value node type ${type}`);
}

function printAttributes(node) {
  return nodeAttributes(node).map((attribute) => {
    const name = getStringProperty(attribute, "name");
    const value = getSubCollection(attribute, "child");
    if (!value) throw new Error(`Panorama attribute ${name} is missing a value`);
    return ` ${name}=${printAttributeOrReferenceValue(value)}`;
  }).join("");
}

function printPanelBase(name, node, level, out) {
  const children = nodeChildren(node);
  const attributes = printAttributes(node);
  if (children.length === 0) {
    out.push(`${indent(level)}<${name}${attributes} />`);
    return;
  }

  out.push(`${indent(level)}<${name}${attributes}>`);
  for (const child of children) {
    printNode(child, level + 1, out);
  }
  out.push(`${indent(level)}</${name}>`);
}

function printInclude(node, level, out) {
  const reference = getSubCollection(node, "child");
  if (!reference) throw new Error("Panorama include is missing a child reference");
  out.push(`${indent(level)}<include src=${printAttributeOrReferenceValue(reference)} />`);
}

function printScriptBody(node, level, out) {
  out.push(`${indent(level)}<script><![CDATA[${getStringProperty(node, "name")}]]></script>`);
}

function printSnippet(node, level, out) {
  out.push(`${indent(level)}<snippet name="${escapeAttribute(getStringProperty(node, "name"))}">`);
  for (const child of nodeChildren(node)) {
    printNode(child, level + 1, out);
  }
  out.push(`${indent(level)}</snippet>`);
}

function printNode(node, level, out) {
  const type = getStringProperty(node, "eType");
  switch (type) {
    case "ROOT":
      printPanelBase("root", node, level, out);
      return;
    case "STYLES":
      printPanelBase("styles", node, level, out);
      return;
    case "INCLUDE":
      printInclude(node, level, out);
      return;
    case "PANEL":
      printPanelBase(getStringProperty(node, "name"), node, level, out);
      return;
    case "SCRIPT_BODY":
      printScriptBody(node, level, out);
      return;
    case "SCRIPTS":
      printPanelBase("scripts", node, level, out);
      return;
    case "SNIPPET":
      printSnippet(node, level, out);
      return;
    case "SNIPPETS":
      printPanelBase("snippets", node, level, out);
      return;
    default:
      throw new Error(`Unknown Panorama layout node type ${type}`);
  }
}

export function printPanoramaLayout(layoutRoot) {
  const ast = getSubCollection(layoutRoot, "m_AST");
  const root = ast ? getSubCollection(ast, "m_pRoot") : null;
  if (!root) {
    throw new Error("Unknown LaCo format, unable to reconstruct XML");
  }

  const out = ["<!-- xml reconstructed from LaCo binary layout AST -->"];
  printNode(root, 0, out);
  return `${out.join("\n")}\n`;
}
