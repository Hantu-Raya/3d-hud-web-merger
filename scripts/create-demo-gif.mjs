import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { writeVpk } from "../src/vpkWriter.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEMO_ROOT = path.join(PROJECT_ROOT, ".tmp-demo");
const FRAME_ROOT = path.join(DEMO_ROOT, "frames");
const PUBLIC_DEMO_ROOT = path.join(PROJECT_ROOT, "public", "demo");
const OUTPUT_GIF = path.join(PUBLIC_DEMO_ROOT, "usage-demo.gif");
const DEMO_URL = process.env.DEMO_URL || "http://127.0.0.1:4328/3d-hud-web-merger/";
const VIEWPORT = { width: 960, height: 760 };
const FRAME_RATE = 12;
const HOLD_FRAMES = 14;
const MOVE_FRAMES = 7;
const CLICK_FRAMES = 4;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

async function createSampleVpk() {
  await fs.mkdir(DEMO_ROOT, { recursive: true });
  const samplePath = path.join(DEMO_ROOT, "sample-addon_dir.vpk");
  const encoder = new TextEncoder();
  const bytes = writeVpk([
    {
      path: "panorama/scripts/sample_existing_addon.vjs_c",
      bytes: encoder.encode("// Demo addon file. The merger keeps existing files.")
    }
  ]);

  await fs.writeFile(samplePath, bytes);
  return samplePath;
}

async function installDemoOverlay(page) {
  await page.addStyleTag({
    content: `
      .demo-callout {
        position: fixed;
        left: 24px;
        bottom: 24px;
        z-index: 99999;
        max-width: 390px;
        padding: 14px 16px;
        border: 1px solid rgba(40, 31, 20, 0.18);
        border-radius: 8px;
        background: rgba(255, 248, 237, 0.94);
        color: #231a13;
        font: 700 16px/1.35 Arial, sans-serif;
        box-shadow: 0 12px 30px rgba(40, 31, 20, 0.16);
      }

      .demo-cursor {
        position: fixed;
        z-index: 100000;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid #231a13;
        background: #f4b861;
        box-shadow: 0 0 0 6px rgba(244, 184, 97, 0.28);
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      .demo-cursor::after {
        content: "";
        position: absolute;
        inset: -10px;
        border: 1px solid rgba(40, 31, 20, 0.22);
        border-radius: 50%;
      }

      .demo-cursor.is-clicking {
        background: #f08b62;
        box-shadow: 0 0 0 10px rgba(240, 139, 98, 0.2);
      }
    `
  });

  await page.evaluate(() => {
    const callout = document.createElement("div");
    callout.className = "demo-callout";
    document.body.appendChild(callout);

    const cursor = document.createElement("div");
    cursor.className = "demo-cursor";
    document.body.appendChild(cursor);
  });
}

async function setDemoOverlay(page, text, x, y, options = {}) {
  await page.evaluate(
    ({ isClicking, scale, text: nextText, x: nextX, y: nextY }) => {
      const callout = document.querySelector(".demo-callout");
      const cursor = document.querySelector(".demo-cursor");
      if (callout) callout.textContent = nextText;
      if (cursor) {
        cursor.style.left = `${nextX}px`;
        cursor.style.top = `${nextY}px`;
        cursor.style.transform = `translate(-50%, -50%) scale(${scale})`;
        cursor.classList.toggle("is-clicking", isClicking);
      }
    },
    { isClicking: !!options.isClicking, scale: options.scale || 1, text, x, y }
  );
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

async function captureFrame(page, frames) {
  const nextIndex = String(frames.count).padStart(4, "0");
  await page.screenshot({ path: path.join(FRAME_ROOT, `frame-${nextIndex}.png`) });
  frames.count += 1;
}

async function holdCursor(page, frames, text, point, frameCount = HOLD_FRAMES) {
  await setDemoOverlay(page, text, point.x, point.y);
  for (let i = 0; i < frameCount; i += 1) {
    await captureFrame(page, frames);
  }
}

async function moveCursor(page, frames, text, fromPoint, toPoint) {
  for (let i = 1; i <= MOVE_FRAMES; i += 1) {
    const progress = easeOutCubic(i / MOVE_FRAMES);
    const x = fromPoint.x + (toPoint.x - fromPoint.x) * progress;
    const y = fromPoint.y + (toPoint.y - fromPoint.y) * progress;
    await setDemoOverlay(page, text, Math.round(x), Math.round(y));
    await captureFrame(page, frames);
  }
}

async function clickCursor(page, frames, text, point) {
  const scales = [0.86, 1.18, 1.04, 1];
  for (let i = 0; i < CLICK_FRAMES; i += 1) {
    await setDemoOverlay(page, text, point.x, point.y, {
      isClicking: i < CLICK_FRAMES - 1,
      scale: scales[i] || 1
    });
    await captureFrame(page, frames);
  }
}

async function generateFrames(sampleVpkPath) {
  await fs.rm(FRAME_ROOT, { recursive: true, force: true });
  await fs.mkdir(FRAME_ROOT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: VIEWPORT
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    localStorage.setItem("3d-hud-theme-mode", "light");
  });

  const frames = { count: 0 };
  const choosePoint = { x: 88, y: 345 };
  const resultPoint = { x: 744, y: 545 };
  const repackPoint = { x: 740, y: 385 };
  const downloadPoint = { x: 730, y: 735 };

  try {
    await page.goto(DEMO_URL, { waitUntil: "networkidle" });
    await installDemoOverlay(page);
    await holdCursor(page, frames, "1. Choose an existing Deadlock addon VPK.", choosePoint);

    await page.locator('input[type="file"]').setInputFiles(sampleVpkPath);
    await page.getByRole("heading", { name: "Ready to merge" }).waitFor({ timeout: 10000 });
    await moveCursor(page, frames, "2. The browser checks entries and confirms the merge is safe.", choosePoint, resultPoint);
    await holdCursor(page, frames, "2. The browser checks entries and confirms the merge is safe.", resultPoint, 10);

    await moveCursor(page, frames, "3. Repack a merged copy. The original VPK stays untouched.", resultPoint, repackPoint);
    await holdCursor(page, frames, "3. Repack a merged copy. The original VPK stays untouched.", repackPoint, 8);
    await clickCursor(page, frames, "3. Repack a merged copy. The original VPK stays untouched.", repackPoint);
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.locator("button.primary-action").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(DEMO_ROOT, await download.suggestedFilename()));
    await page.getByText("Built merged-sample-addon_dir.vpk", { exact: false }).waitFor({ timeout: 10000 });
    await moveCursor(page, frames, "4. Download the merged VPK and place it in your addons folder.", repackPoint, downloadPoint);
    await holdCursor(page, frames, "4. Download the merged VPK and place it in your addons folder.", downloadPoint, 16);
  } finally {
    await browser.close();
  }

  return frames.count;
}

async function buildGif(frameCount) {
  await fs.mkdir(PUBLIC_DEMO_ROOT, { recursive: true });
  const palettePath = path.join(DEMO_ROOT, "palette.png");
  const framePattern = path.join(FRAME_ROOT, "frame-%04d.png");

  run("ffmpeg", [
    "-y",
    "-framerate",
    String(FRAME_RATE),
    "-i",
    framePattern,
    "-vf",
    `fps=${FRAME_RATE},scale=860:-1:flags=lanczos,palettegen`,
    palettePath
  ]);

  run("ffmpeg", [
    "-y",
    "-framerate",
    String(FRAME_RATE),
    "-i",
    framePattern,
    "-i",
    palettePath,
    "-lavfi",
    `fps=${FRAME_RATE},scale=860:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    OUTPUT_GIF
  ]);

  const stats = await fs.stat(OUTPUT_GIF);
  console.log(`Wrote ${path.relative(PROJECT_ROOT, OUTPUT_GIF)} from ${frameCount} frames (${stats.size.toLocaleString()} bytes).`);
}

async function main() {
  const sampleVpkPath = await createSampleVpk();
  const frameCount = await generateFrames(sampleVpkPath);
  await buildGif(frameCount);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
