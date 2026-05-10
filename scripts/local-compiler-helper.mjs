import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createCompilerBackedHudMergePlan,
  finalizeCompilerBackedHudMerge
} from "../src/compilerBackedMerge.js";
import { parseVpk } from "../src/vpkReader.js";
import { writeVpk } from "../src/vpkWriter.js";

const PORT = Number(process.env.HUD_INJECT_HELPER_PORT || 4329);
const MAX_UPLOAD_BYTES = Number(process.env.HUD_INJECT_MAX_UPLOAD_BYTES || 512 * 1024 * 1024);
const DEFAULT_MOD_ROOT = "F:\\Users\\FoxOS_User\\Desktop\\Deadlock-mods-collection";
const MOD_ROOT = process.env.HUD_INJECT_MOD_ROOT || DEFAULT_MOD_ROOT;
const RAW_HUD_SOURCE = process.env.HUD_INJECT_3D_HUD_SOURCE || path.join(MOD_ROOT, "3d hud");
const COMPILER_EXE = process.env.HUD_INJECT_SR2COMPILER || path.join(MOD_ROOT, "sr2compiler", "New folder.exe");
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PAYLOAD_ROOT = path.join(PROJECT_ROOT, "public", "payload", "3d-hud");
const DEFAULT_ALLOWED_ORIGINS = ["https://hantu-raya.github.io"];
const ALLOWED_ORIGINS = new Set(
  String(process.env.HUD_INJECT_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function normalizePayloadPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function isOriginAllowed(request) {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin) || isLoopbackOrigin(origin);
}

function corsHeaders(request, extra = {}) {
  const origin = request.headers.origin;
  const allowOrigin = origin && isOriginAllowed(request) ? origin : (!origin ? "*" : "");
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    ...(origin ? { Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-File-Name",
    "Access-Control-Expose-Headers": "Content-Disposition,X-Hud-Inject-Patched-Paths,X-Hud-Inject-Conflicts",
    ...extra
  };
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sendJson(request, response, status, body) {
  response.writeHead(status, corsHeaders(request, { "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(body, null, 2));
}

function toHeaderValue(value) {
  return String(value || "").replace(/[\r\n"]/g, "_");
}

function outputFilename(inputName) {
  const clean = path.basename(String(inputName || "addon.vpk")).replace(/[\\/:*?"<>|]+/g, "_") || "addon.vpk";
  return clean.toLowerCase().endsWith(".vpk") ? `merged-${clean}` : `merged-${clean}.vpk`;
}

async function readRequestBytes(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error(`Uploaded VPK exceeds ${MAX_UPLOAD_BYTES} bytes`), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  return new Uint8Array(Buffer.concat(chunks, total));
}

async function loadPayloadFromDisk() {
  const manifest = JSON.parse(await readFile(path.join(PAYLOAD_ROOT, "manifest.json"), "utf8"));
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("3D HUD payload manifest has no files");
  }

  const files = [];
  for (const rawPath of manifest.files) {
    const payloadPath = normalizePayloadPath(rawPath);
    files.push({
      path: payloadPath,
      bytes: new Uint8Array(await readFile(path.join(PAYLOAD_ROOT, ...payloadPath.split("/"))))
    });
  }

  return {
    files,
    hudProbeSource: await readFile(path.join(PAYLOAD_ROOT, "hud-probe.xml"), "utf8")
  };
}

function assertLocalTooling() {
  if (!existsSync(RAW_HUD_SOURCE)) {
    throw new Error(`3D HUD source folder not found: ${RAW_HUD_SOURCE}`);
  }
  if (!existsSync(COMPILER_EXE)) {
    throw new Error(`Source 2 compiler wrapper not found: ${COMPILER_EXE}`);
  }
}

async function runProcess(file, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
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

async function compileSourcePatches(sourcePatches) {
  if (sourcePatches.length === 0) return [];

  assertLocalTooling();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "3d-hud-inject-"));
  const sourceDir = path.join(tempRoot, "source");
  const compiledDir = `${sourceDir}_compiled`;

  try {
    await cp(RAW_HUD_SOURCE, sourceDir, { recursive: true });
    for (const patch of sourcePatches) {
      const outputPath = path.join(sourceDir, ...patch.sourcePath.split("/"));
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, patch.source, "utf8");
    }

    const compile = await runProcess(COMPILER_EXE, [sourceDir], { timeoutMs: 300000 });
    const compiledFiles = [];
    const missingOutputs = [];
    for (const patch of sourcePatches) {
      const compiledPath = path.join(compiledDir, ...patch.compiledPath.split("/"));
      if (!existsSync(compiledPath)) {
        missingOutputs.push(patch.compiledPath);
        continue;
      }
      compiledFiles.push({
        path: patch.compiledPath,
        bytes: new Uint8Array(await readFile(compiledPath))
      });
    }

    if (missingOutputs.length > 0) {
      const compileStatus = compile.code === 0 ? "" : `Compiler exited with code ${compile.code}.`;
      const output = [compileStatus, compile.stdout, compile.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`Compiler did not emit ${missingOutputs.join(", ")}${output ? `\n${output}` : ""}`);
    }

    return compiledFiles;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function mergeUploadedVpk(inputBytes) {
  const parsed = parseVpk(inputBytes);
  const payload = await loadPayloadFromDisk();
  const plan = createCompilerBackedHudMergePlan(parsed.files, payload.files, {
    hudProbeSource: payload.hudProbeSource
  });

  if (!plan.files || plan.blockedConflicts.length > 0) {
    const error = new Error(`Blocked by ${plan.blockedConflicts.length} unresolved conflicting path${plan.blockedConflicts.length === 1 ? "" : "s"}`);
    error.statusCode = 409;
    error.conflicts = plan.conflicts;
    throw error;
  }

  const compiledFiles = await compileSourcePatches(plan.sourcePatches);
  const files = finalizeCompilerBackedHudMerge(plan, compiledFiles);
  return {
    bytes: writeVpk(files),
    conflicts: plan.conflicts,
    patchedPaths: plan.patchedPaths
  };
}

const server = createServer(async (request, response) => {
  try {
    if (!isOriginAllowed(request)) {
      sendJson(request, response, 403, { error: "Origin not allowed by local compiler helper" });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(request, response, 200, {
        ok: true,
        compiler: COMPILER_EXE,
        source: RAW_HUD_SOURCE,
        payload: PAYLOAD_ROOT,
        compilerExists: existsSync(COMPILER_EXE),
        sourceExists: existsSync(RAW_HUD_SOURCE)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/merge") {
      const uploadName = request.headers["x-file-name"] || "addon.vpk";
      const inputBytes = await readRequestBytes(request);
      const result = await mergeUploadedVpk(inputBytes);
      const outputName = outputFilename(uploadName);
      response.writeHead(200, corsHeaders(request, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${toHeaderValue(outputName)}"`,
        "X-Hud-Inject-Patched-Paths": result.patchedPaths.join(","),
        "X-Hud-Inject-Conflicts": String(result.conflicts.length)
      }));
      response.end(Buffer.from(result.bytes));
      return;
    }

    sendJson(request, response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(request, response, error.statusCode || 500, {
      error: error?.message || String(error),
      conflicts: error?.conflicts || undefined
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`3D HUD local compiler helper listening on http://127.0.0.1:${PORT}`);
  console.log(`Source: ${RAW_HUD_SOURCE}`);
  console.log(`Compiler: ${COMPILER_EXE}`);
});
