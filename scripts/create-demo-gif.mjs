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
const HOLD_FRAMES = 26;
const MOVE_FRAMES = 11;
const CLICK_FRAMES = 5;
const DEMO_MIN_HUD_UI_SCALE = 120;
const DEMO_MAX_HUD_UI_SCALE = 170;
const DEMO_DEFAULT_HUD_UI_SCALE = 170;
const DEMO_PREVIEW_HUD_UI_SCALE = 145;
const SCALE_DEMO_TEXT = "1. Set HUD UI scale first. Use 170 for browser-only merging; lower values need the local helper.";

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
        bottom: 18px;
        z-index: 99999;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        align-items: center;
        gap: 14px;
        width: min(540px, calc(100vw - 48px));
        min-height: 96px;
        padding: 18px 20px;
        border: 1px solid rgba(235, 201, 142, 0.38);
        border-radius: 8px;
        background: rgba(30, 24, 18, 0.96);
        color: #fff6e7;
        font: 800 18px/1.32 Arial, sans-serif;
        box-shadow: 0 16px 40px rgba(25, 18, 12, 0.24);
      }

      .demo-step {
        display: grid;
        place-items: center;
        inline-size: 42px;
        block-size: 42px;
        border: 1px solid rgba(235, 201, 142, 0.48);
        border-radius: 999px;
        color: #f4c06d;
        font: 800 18px/1 Arial, sans-serif;
      }

      .demo-copy {
        min-width: 0;
      }

      .demo-cursor {
        position: fixed;
        z-index: 100000;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid #231a13;
        background: #f4b861;
        box-shadow: 0 0 0 8px rgba(244, 184, 97, 0.28);
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
    callout.setAttribute("aria-hidden", "true");
    const step = document.createElement("span");
    step.className = "demo-step";
    const copy = document.createElement("span");
    copy.className = "demo-copy";
    callout.append(step, copy);
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
      const step = document.querySelector(".demo-step");
      const copy = document.querySelector(".demo-copy");
      const cursor = document.querySelector(".demo-cursor");
      if (callout && step && copy) {
        const match = nextText.match(/^(\d+)\.\s*(.*)$/);
        step.textContent = match ? match[1] : "";
        copy.textContent = match ? match[2] : nextText;
      }
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

async function setHudUiScale(page, value) {
  await page.locator("#hud-ui-scale").evaluate((input, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (valueSetter) {
      valueSetter.call(input, String(nextValue));
    } else {
      input.value = String(nextValue);
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function getLocatorPoint(page, selector, xRatio = 0.5, yRatio = 0.5) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    throw new Error(`Unable to locate ${selector} for demo capture.`);
  }

  return {
    x: Math.round(box.x + box.width * xRatio),
    y: Math.round(box.y + box.height * yRatio)
  };
}

async function getHudUiScalePoint(page, value) {
  const box = await page.locator("#hud-ui-scale").boundingBox();
  if (!box) {
    throw new Error("HUD UI scale slider was not visible for demo capture.");
  }

  const trackInset = 8;
  const ratio = (value - DEMO_MIN_HUD_UI_SCALE) / (DEMO_MAX_HUD_UI_SCALE - DEMO_MIN_HUD_UI_SCALE);
  const x = box.x + trackInset + (box.width - trackInset * 2) * ratio;
  return {
    x: Math.round(x),
    y: Math.round(box.y + box.height / 2)
  };
}

async function slideHudUiScale(page, frames, text, fromPoint, toPoint, fromValue, toValue) {
  const totalFrames = MOVE_FRAMES + 4;
  for (let i = 1; i <= totalFrames; i += 1) {
    const progress = easeOutCubic(i / totalFrames);
    const x = fromPoint.x + (toPoint.x - fromPoint.x) * progress;
    const y = fromPoint.y + (toPoint.y - fromPoint.y) * progress;
    const value = Math.round(fromValue + (toValue - fromValue) * progress);
    await setHudUiScale(page, value);
    await setDemoOverlay(page, text, Math.round(x), Math.round(y), {
      isClicking: i < totalFrames,
      scale: 0.94
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

  try {
    await page.goto(DEMO_URL, { waitUntil: "networkidle" });
    await installDemoOverlay(page);

    const defaultScalePoint = await getHudUiScalePoint(page, DEMO_DEFAULT_HUD_UI_SCALE);
    const previewScalePoint = await getHudUiScalePoint(page, DEMO_PREVIEW_HUD_UI_SCALE);
    await holdCursor(page, frames, SCALE_DEMO_TEXT, defaultScalePoint, 44);
    await slideHudUiScale(
      page,
      frames,
      SCALE_DEMO_TEXT,
      defaultScalePoint,
      previewScalePoint,
      DEMO_DEFAULT_HUD_UI_SCALE,
      DEMO_PREVIEW_HUD_UI_SCALE
    );
    await holdCursor(page, frames, SCALE_DEMO_TEXT, previewScalePoint, 32);
    await slideHudUiScale(
      page,
      frames,
      SCALE_DEMO_TEXT,
      previewScalePoint,
      defaultScalePoint,
      DEMO_PREVIEW_HUD_UI_SCALE,
      DEMO_DEFAULT_HUD_UI_SCALE
    );
    await holdCursor(page, frames, SCALE_DEMO_TEXT, defaultScalePoint, 24);

    const choosePoint = await getLocatorPoint(page, ".file-command", 0.1, 0.5);
    await moveCursor(page, frames, "2. Choose an existing Deadlock addon VPK.", defaultScalePoint, choosePoint);
    await holdCursor(page, frames, "2. Choose an existing Deadlock addon VPK.", choosePoint, 12);
    await clickCursor(page, frames, "2. Choose an existing Deadlock addon VPK.", choosePoint);

    await page.locator('input[type="file"]').setInputFiles(sampleVpkPath);
    await page.getByRole("heading", { name: "Ready to merge" }).waitFor({ timeout: 10000 });
    const resultPoint = await getLocatorPoint(page, ".result-card", 0.88, 0.08);
    const repackPoint = await getLocatorPoint(page, "button.primary-action", 0.52, 0.5);
    await moveCursor(page, frames, "3. The browser checks the VPK and confirms it can merge safely.", choosePoint, resultPoint);
    await holdCursor(page, frames, "3. The browser checks the VPK and confirms it can merge safely.", resultPoint);

    await moveCursor(page, frames, "4. Repack a merged copy. The original VPK stays untouched.", resultPoint, repackPoint);
    await holdCursor(page, frames, "4. Repack a merged copy. The original VPK stays untouched.", repackPoint, 14);
    await clickCursor(page, frames, "4. Repack a merged copy. The original VPK stays untouched.", repackPoint);
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.locator("button.primary-action").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(DEMO_ROOT, await download.suggestedFilename()));
    await page.getByText("Built merged-sample-addon_dir.vpk", { exact: false }).waitFor({ timeout: 10000 });
    const downloadPoint = await getLocatorPoint(page, ".result-card .state-chip", 0.5, 0.5);
    await moveCursor(page, frames, "5. Download the merged VPK and place it in your addons folder.", repackPoint, downloadPoint);
    await holdCursor(page, frames, "5. Download the merged VPK and place it in your addons folder.", downloadPoint);
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
