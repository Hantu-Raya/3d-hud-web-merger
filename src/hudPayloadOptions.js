export const MIN_HUD_UI_SCALE = 120;
export const MAX_HUD_UI_SCALE = 170;
export const DEFAULT_HUD_UI_SCALE = 170;
const DEFAULT_HEALTH_REGEN_MARGIN_RIGHT = 20;
const RECENT_COUNTER_STACK_HEIGHT = 96;
const RECENT_COUNTER_MARGIN_TOP = -36;
const RECENT_HEAL_MARGIN_RIGHT = 86;
const RECENT_DAMAGE_MARGIN_RIGHT = -158;

export function normalizeHudUiScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_HUD_UI_SCALE;
  return Math.max(MIN_HUD_UI_SCALE, Math.min(MAX_HUD_UI_SCALE, Math.round(numeric)));
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
