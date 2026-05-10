function normalizeCssForCompare(source) {
  return String(source || "").replace(/\s+/g, "");
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

  const separator = existingSource.endsWith("\n") || existingSource.length === 0 ? "" : "\n";
  return `${existingSource}${separator}${payloadSource}\n`;
}
