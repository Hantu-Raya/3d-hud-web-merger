import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

import {
  CSS_HIJACK_STYLE_PATHS,
  cssHijackBaseImportFor,
  cssHijackBasePathFor,
  isCssHijackStylePath
} from "../src/cssHijackPaths.js";
import { createCssHijackSource } from "../src/hudStylePatch.js";
import {
  DEFAULT_HUD_UI_SCALE,
  HUD_UI_SCALE_PATCHED_PATHS,
  MAX_HUD_UI_SCALE,
  MIN_HUD_UI_SCALE,
  createFileSignature,
  patchHudHealthContainerStyleSource,
  patchHudScaleStyleSource,
  patchStatusEffectStyleSource
} from "../src/hudPayloadOptions.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PAYLOAD_ROOT = path.join(PROJECT_ROOT, "public", "payload", "3d-hud");
const DEFAULT_REPOSITORY = "Hantu-Raya/Deadlock-mods-collection";
const SOURCE_REPOSITORY = process.env.HUD_PAYLOAD_SOURCE_REPOSITORY || DEFAULT_REPOSITORY;
const SOURCE_REF = process.env.HUD_PAYLOAD_SOURCE_REF || "main";
const SOURCE_DIR = process.env.HUD_PAYLOAD_SOURCE_DIR || "3d hud";
const DEFAULT_BASE_REPOSITORY = "SteamTracking/GameTracking-Deadlock";
const BASE_REPOSITORY = process.env.HUD_BASE_SOURCE_REPOSITORY || DEFAULT_BASE_REPOSITORY;
const BASE_REF = process.env.HUD_BASE_SOURCE_REF || "master";
const BASE_SOURCE_DIR = process.env.HUD_BASE_SOURCE_DIR || "game/citadel/pak01_dir/panorama/styles";
const DEFAULT_MOD_ROOT = "F:\\Users\\FoxOS_User\\Desktop\\Deadlock-mods-collection";
const MOD_ROOT = process.env.HUD_INJECT_MOD_ROOT || DEFAULT_MOD_ROOT;
const COMPILER_EXE = process.env.HUD_INJECT_SR2COMPILER || path.join(MOD_ROOT, "sr2compiler", "New folder.exe");
const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const USER_AGENT = "3d-hud-web-merger-payload-sync";
const DYNAMIC_SCRIPT_SOURCE_PATH = "panorama/scripts/3d_hero_dynamic.js";
const DYNAMIC_SCRIPT_COMPILED_PATH = "panorama/scripts/3d_hero_dynamic.vjs_c";
const HUD_SCALE_SOURCE_PATH = "panorama/styles/3d_hud.css";
const HUD_HEALTH_CONTAINER_STYLE_SOURCE_PATH = "panorama/styles/hud_health_container.css";
const HUD_UI_SCALE_VARIANT_ROOT = "options/hud-ui-scale";

const SOURCE_FILES = [
  {
    sourcePath: "panorama/layout/hud.xml",
    compiledPath: "panorama/layout/hud.vxml_c",
    extractHudProbe: true
  },
  {
    sourcePath: "panorama/layout/hud_health.xml",
    compiledPath: "panorama/layout/hud_health.vxml_c",
    patchSource: removeTemporaryAnitaPersistLoader
  },
  {
    sourcePath: DYNAMIC_SCRIPT_SOURCE_PATH,
    compiledPath: DYNAMIC_SCRIPT_COMPILED_PATH,
    minify: true
  },
  {
    sourcePath: "panorama/styles/3d_hud.css",
    compiledPath: "panorama/styles/3d_hud.vcss_c",
    patchSource: (source) => patchHudScaleStyleSource(source, DEFAULT_HUD_UI_SCALE)
  },
  {
    sourcePath: "panorama/styles/citadel_status_effect.css",
    compiledPath: "panorama/styles/citadel_status_effect.vcss_c",
    patchSource: patchStatusEffectStyleSource
  },
  {
    sourcePath: "panorama/styles/hud_health.css",
    compiledPath: "panorama/styles/hud_health.vcss_c"
  },
  {
    sourcePath: "panorama/styles/hud_health_container.css",
    compiledPath: "panorama/styles/hud_health_container.vcss_c",
    patchSource: patchHudHealthContainerStyleSource
  },
  {
    sourcePath: "panorama/styles/unit_status_icons.css",
    compiledPath: "panorama/styles/unit_status_icons.vcss_c"
  }
];

const PRESERVED_COMPILED_FILES = [
  "panorama/layout/hud_health_container.vxml_c"
];

const BASE_CSS_FILES = CSS_HIJACK_STYLE_PATHS.map((compiledPath) => {
  const cssFileName = path.basename(compiledPath).replace(/\.vcss_c$/i, ".css");
  return {
    sourcePath: `panorama/styles/base/${cssFileName}`,
    compiledPath: cssHijackBasePathFor(compiledPath),
    upstreamPath: `${BASE_SOURCE_DIR}/${cssFileName}`
  };
});

const MANIFEST_FILES = [
  "panorama/layout/hud.vxml_c",
  "panorama/layout/hud_health_container.vxml_c",
  "panorama/layout/hud_health.vxml_c",
  "panorama/scripts/3d_hero_dynamic.vjs_c",
  ...CSS_HIJACK_STYLE_PATHS.map(cssHijackBasePathFor),
  "panorama/styles/3d_hud.vcss_c",
  "panorama/styles/citadel_status_effect.vcss_c",
  "panorama/styles/hud_health.vcss_c",
  "panorama/styles/hud_health_container.vcss_c",
  "panorama/styles/unit_status_icons.vcss_c"
];

function pathSegments(value) {
  return String(value || "").split("/").filter(Boolean);
}

function joinRawUrl(...segments) {
  return `${RAW_GITHUB}/${segments.flatMap(pathSegments).map(encodeURIComponent).join("/")}`;
}

function localPath(root, relativePath) {
  return path.join(root, ...pathSegments(relativePath));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  return await response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  return await response.text();
}

async function resolveRepositoryCommit(repository, ref) {
  const commit = await fetchJson(`${GITHUB_API}/repos/${repository}/commits/${encodeURIComponent(ref)}`);
  if (!commit?.sha) {
    throw new Error(`GitHub did not return a commit SHA for ${repository}@${ref}`);
  }
  return commit.sha;
}

async function resolveRepositoryPathCommit(repository, ref, repositoryPath) {
  const url = new URL(`${GITHUB_API}/repos/${repository}/commits`);
  url.searchParams.set("sha", ref);
  url.searchParams.set("path", repositoryPath);
  url.searchParams.set("per_page", "1");

  const commits = await fetchJson(url.toString());
  if (!Array.isArray(commits) || !commits[0]?.sha) {
    throw new Error(`GitHub did not return a commit SHA for ${repositoryPath} in ${repository}@${ref}`);
  }
  return commits[0].sha;
}

async function downloadSourceFile(commitSha, sourcePath) {
  return await fetchText(joinRawUrl(SOURCE_REPOSITORY, commitSha, SOURCE_DIR, sourcePath));
}

async function downloadBaseCssFile(baseCommitSha, upstreamPath) {
  return await fetchText(joinRawUrl(BASE_REPOSITORY, baseCommitSha, upstreamPath));
}

async function minifyJavascript(sourceText, sourcePath) {
  const result = await minify(sourceText, {
    compress: {
      passes: 2
    },
    mangle: true,
    format: {
      ascii_only: true,
      comments: false
    }
  });

  if (!result.code) {
    throw new Error(`Terser did not emit code for ${sourcePath}`);
  }

  return `${result.code}\n`;
}

const ANITA_PERSIST_LOADER_INCLUDE = /[ \t]*<include\b(?=[^>]*\bsrc\s*=\s*["']s2r:\/\/panorama\/scripts\/anita_persist_loader\.vjs_c["'])[^>]*\/>[ \t]*(?:\r?\n)?/gi;

function removeTemporaryAnitaPersistLoader(sourceText) {
  return String(sourceText || "")
    .replace(ANITA_PERSIST_LOADER_INCLUDE, "")
    .replace(/[ \t]*<scripts\b[^>]*>\s*<\/scripts>[ \t]*(?:\r?\n)?/gi, "");
}

function findProbePanelBlock(source) {
  const openPattern = /<Panel\b(?=[^>]*\bid\s*=\s*["']ThreeDHeroHudProbe["'])[^>]*>/i;
  const openMatch = source.match(openPattern);
  if (!openMatch || openMatch.index === undefined) {
    throw new Error("Latest hud.xml does not contain ThreeDHeroHudProbe");
  }

  const start = openMatch.index;
  if (/\/\s*>$/.test(openMatch[0])) {
    return openMatch[0];
  }

  const panelPattern = /<\/?Panel\b[^>]*>/gi;
  panelPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = panelPattern.exec(source))) {
    const tag = match[0];
    const isClosing = /^<\//.test(tag);
    const isSelfClosing = /\/\s*>$/.test(tag);
    if (!isClosing && !isSelfClosing) depth += 1;
    if (isClosing) depth -= 1;
    if (depth === 0) {
      return source.slice(start, panelPattern.lastIndex);
    }
  }

  throw new Error("Latest ThreeDHeroHudProbe panel is malformed");
}

async function runProcess(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd || PROJECT_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(file)} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs || 300000);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

async function stageSource(commitSha, sourceRoot, baseCssSources = new Map()) {
  let hudProbeSource = "";
  const stagedSourcesByPath = new Map();

  for (const file of SOURCE_FILES) {
    let source = await downloadSourceFile(commitSha, file.sourcePath);
    if (file.extractHudProbe) {
      hudProbeSource = findProbePanelBlock(source).trim();
    }
    if (file.patchSource) {
      source = file.patchSource(source);
    }
    if (isCssHijackStylePath(file.compiledPath)) {
      source = createCssHijackSource(
        cssHijackBaseImportFor(file.compiledPath),
        source,
        baseCssSources.get(file.compiledPath)
      );
    }
    if (file.minify) {
      source = await minifyJavascript(source, file.sourcePath);
    }

    stagedSourcesByPath.set(file.sourcePath, source);
    const destination = localPath(sourceRoot, file.sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }

  if (!hudProbeSource) {
    throw new Error("Could not extract hud-probe.xml from latest hud.xml");
  }

  return {
    hudProbeSource,
    stagedSourcesByPath
  };
}

async function stageBaseCssSource(baseCommitSha, sourceRoot) {
  const sourcesByCompiledPath = new Map();
  for (const file of BASE_CSS_FILES) {
    const source = await downloadBaseCssFile(baseCommitSha, file.upstreamPath);
    sourcesByCompiledPath.set(file.compiledPath.replace("/base/", "/"), source);
    const destination = localPath(sourceRoot, file.sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }
  return sourcesByCompiledPath;
}

async function compileSource(sourceRoot, requiredCompiledPaths = [
  ...SOURCE_FILES.map((file) => file.compiledPath),
  ...BASE_CSS_FILES.map((file) => file.compiledPath)
]) {
  if (!existsSync(COMPILER_EXE)) {
    throw new Error(`Source 2 compiler wrapper not found: ${COMPILER_EXE}`);
  }

  const result = await runProcess(COMPILER_EXE, [sourceRoot], { timeoutMs: 300000 });
  const compiledRoot = `${sourceRoot}_compiled`;
  const missing = requiredCompiledPaths
    .filter((compiledPath) => !existsSync(localPath(compiledRoot, compiledPath)));

  if (missing.length > 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Compiler did not emit ${missing.join(", ")}${output ? `\n${output}` : ""}`);
  }

  return { compiledRoot, result };
}

async function copyCompiledPayload(compiledRoot) {
  await mkdir(PAYLOAD_ROOT, { recursive: true });

  for (const file of [...SOURCE_FILES, ...BASE_CSS_FILES]) {
    const from = localPath(compiledRoot, file.compiledPath);
    const to = localPath(PAYLOAD_ROOT, file.compiledPath);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to);
  }

  for (const compiledPath of PRESERVED_COMPILED_FILES) {
    const newlyCompiled = localPath(compiledRoot, compiledPath);
    const payloadPath = localPath(PAYLOAD_ROOT, compiledPath);
    if (existsSync(newlyCompiled)) {
      await mkdir(path.dirname(payloadPath), { recursive: true });
      await cp(newlyCompiled, payloadPath);
      continue;
    }
    if (!existsSync(payloadPath)) {
      throw new Error(`${compiledPath} is not produced by the latest source and no existing payload copy is available`);
    }
  }

}

function hudUiScaleVariantPath(scale, compiledPath) {
  return `${HUD_UI_SCALE_VARIANT_ROOT}/${scale}/${compiledPath}`;
}

async function copyHudUiScaleVariantPayload(compiledRoot, scale) {
  const variant = {};
  for (const compiledPath of HUD_UI_SCALE_PATCHED_PATHS) {
    const from = localPath(compiledRoot, compiledPath);
    const to = localPath(PAYLOAD_ROOT, hudUiScaleVariantPath(scale, compiledPath));
    const bytes = await readFile(from);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, bytes);
    variant[compiledPath] = {
      file: hudUiScaleVariantPath(scale, compiledPath),
      ...createFileSignature(bytes)
    };
  }
  return variant;
}

async function writeHudUiScaleVariantSources(sourceRoot, stagedSourcesByPath, scale) {
  const scaleSource = stagedSourcesByPath.get(HUD_SCALE_SOURCE_PATH);
  const healthContainerSource = stagedSourcesByPath.get(HUD_HEALTH_CONTAINER_STYLE_SOURCE_PATH);
  if (!scaleSource || !healthContainerSource) {
    throw new Error("Cannot generate HUD UI scale variants because scale CSS source is missing");
  }

  const nextSources = [
    {
      sourcePath: HUD_SCALE_SOURCE_PATH,
      source: patchHudScaleStyleSource(scaleSource, scale)
    },
    {
      sourcePath: HUD_HEALTH_CONTAINER_STYLE_SOURCE_PATH,
      source: patchHudHealthContainerStyleSource(healthContainerSource, scale)
    }
  ];

  for (const file of nextSources) {
    const destination = localPath(sourceRoot, file.sourcePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.source, "utf8");
  }
}

async function createHudUiScaleVariants(sourceRoot, stagedSourcesByPath) {
  await rm(localPath(PAYLOAD_ROOT, HUD_UI_SCALE_VARIANT_ROOT), { recursive: true, force: true });
  const variants = {};
  for (let scale = MIN_HUD_UI_SCALE; scale <= MAX_HUD_UI_SCALE; scale += 1) {
    if (scale === DEFAULT_HUD_UI_SCALE) continue;
    await writeHudUiScaleVariantSources(sourceRoot, stagedSourcesByPath, scale);
    const { compiledRoot } = await compileSource(sourceRoot, HUD_UI_SCALE_PATCHED_PATHS);
    variants[String(scale)] = await copyHudUiScaleVariantPayload(compiledRoot, scale);
  }
  return variants;
}

async function createHudUiScaleDefaultSignatures() {
  const signatures = {};
  for (const compiledPath of HUD_UI_SCALE_PATCHED_PATHS) {
    signatures[compiledPath] = createFileSignature(await readFile(localPath(PAYLOAD_ROOT, compiledPath)));
  }
  return signatures;
}

async function writePayloadMetadata(commitSha, baseCommitSha, scriptCommitSha, hudProbeSource, hudUiScaleVariants) {
  const scriptRepositoryPath = `${SOURCE_DIR}/${DYNAMIC_SCRIPT_SOURCE_PATH}`;
  const hudUiScaleDefaultSignatures = await createHudUiScaleDefaultSignatures();
  await writeFile(path.join(PAYLOAD_ROOT, "hud-probe.xml"), `${hudProbeSource}\n`, "utf8");
  const manifest = {
    name: "3d-hud",
    source: `https://github.com/${SOURCE_REPOSITORY}/tree/${SOURCE_REF}/${SOURCE_DIR.replaceAll(" ", "%20")}`,
    sourceRepository: SOURCE_REPOSITORY,
    sourceRef: SOURCE_REF,
    sourceCommit: commitSha,
    sourcePath: SOURCE_DIR,
    baseSource: `https://github.com/${BASE_REPOSITORY}/tree/${BASE_REF}/${BASE_SOURCE_DIR}`,
    baseSourceRepository: BASE_REPOSITORY,
    baseSourceRef: BASE_REF,
    baseSourceCommit: baseCommitSha,
    baseSourcePath: BASE_SOURCE_DIR,
    scriptSource: `https://github.com/${SOURCE_REPOSITORY}/blob/${scriptCommitSha}/${scriptRepositoryPath.replaceAll(" ", "%20")}`,
    scriptSourcePath: scriptRepositoryPath,
    scriptCompiledPath: DYNAMIC_SCRIPT_COMPILED_PATH,
    scriptSourceCommit: scriptCommitSha,
    cssHijackBasePath: "panorama/styles/base/",
    cssHijackBaseFiles: CSS_HIJACK_STYLE_PATHS.map(cssHijackBasePathFor),
    compiler: "Source 2 compiler wrapper",
    baseCssSource: "SteamTracking GameTracking-Deadlock",
    scriptMinifier: "terser",
    preservedCompiledFiles: PRESERVED_COMPILED_FILES,
    scaleOptions: {
      hudUiScale: {
        default: DEFAULT_HUD_UI_SCALE,
        min: MIN_HUD_UI_SCALE,
        max: MAX_HUD_UI_SCALE,
        paths: HUD_UI_SCALE_PATCHED_PATHS,
        defaultSignatures: hudUiScaleDefaultSignatures,
        variants: hudUiScaleVariants
      }
    },
    files: MANIFEST_FILES
  };
  await writeFile(path.join(PAYLOAD_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main() {
  const commitSha = await resolveRepositoryCommit(SOURCE_REPOSITORY, SOURCE_REF);
  const scriptCommitSha = await resolveRepositoryPathCommit(
    SOURCE_REPOSITORY,
    SOURCE_REF,
    `${SOURCE_DIR}/${DYNAMIC_SCRIPT_SOURCE_PATH}`
  );
  const baseCommitSha = await resolveRepositoryCommit(BASE_REPOSITORY, BASE_REF);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "3d-hud-payload-"));
  const sourceRoot = path.join(tempRoot, "3d hud");

  try {
    const baseCssSources = await stageBaseCssSource(baseCommitSha, sourceRoot);
    const { hudProbeSource, stagedSourcesByPath } = await stageSource(commitSha, sourceRoot, baseCssSources);
    const { compiledRoot, result } = await compileSource(sourceRoot);
    await copyCompiledPayload(compiledRoot);
    const hudUiScaleVariants = await createHudUiScaleVariants(sourceRoot, stagedSourcesByPath);
    await writePayloadMetadata(commitSha, baseCommitSha, scriptCommitSha, hudProbeSource, hudUiScaleVariants);

    console.log(`Synced payload from ${SOURCE_REPOSITORY}@${commitSha}`);
    console.log(`Synced dynamic script from ${SOURCE_REPOSITORY}@${scriptCommitSha}`);
    console.log(`Synced base CSS from ${BASE_REPOSITORY}@${baseCommitSha}`);
    console.log(`Compiled ${SOURCE_FILES.length} raw source files; minified 3d_hero_dynamic.js with Terser before compile.`);
    console.log(`Compiled ${BASE_CSS_FILES.length} SteamTracking base CSS files into panorama/styles/base.`);
    console.log(`Compiled ${Object.keys(hudUiScaleVariants).length} HUD UI scale variants for browser-only scaling.`);
    console.log(`Preserved ${PRESERVED_COMPILED_FILES.length} compiled compatibility file not present in upstream raw source.`);
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
