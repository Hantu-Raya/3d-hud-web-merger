import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { createCompilerBackedHudMergePlan } from "../compilerBackedMerge.js";
import { hasCssHijackBaseFolder } from "../cssHijackPaths.js";
import { downloadBytes } from "../download.js";
import { resolveHudPayloadConflicts } from "../hudConflictResolver.js";
import { loadHudPayload } from "../hudPayload.js";
import {
  DEFAULT_HUD_UI_SCALE,
  MAX_HUD_UI_SCALE,
  MIN_HUD_UI_SCALE,
  normalizeHudUiScale,
  requiresCompilerForHudUiScale
} from "../hudPayloadOptions.js";
import { parseVpk } from "../vpkReader.js";
import { writeVpk } from "../vpkWriter.js";

const DEFAULT_COMPILER_HELPER_URL = "http://127.0.0.1:4329";
const THEME_STORAGE_KEY = "3d-hud-theme-mode";
const TUTORIAL_GIF_PATH = "demo/usage-demo.gif";
const COMPILER_HELPER_URL = String(
  import.meta.env.PUBLIC_HUD_INJECT_HELPER_URL || DEFAULT_COMPILER_HELPER_URL
).replace(/\/+$/, "");

function joinAssetPath(baseUrl, path) {
  const base = String(baseUrl || "/");
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  return `${cleanBase}${String(path || "").replace(/^\/+/, "")}`;
}

function compilerHelperEndpoint(path) {
  return `${COMPILER_HELPER_URL}/${String(path || "").replace(/^\/+/, "")}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function outputFilename(inputName) {
  const clean = String(inputName || "addon.vpk").replace(/[\\/:*?"<>|]+/g, "_");
  return clean.toLowerCase().endsWith(".vpk") ? `merged-${clean}` : `merged-${clean}.vpk`;
}

function getStoredThemeMode() {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function resolveThemeMode(mode) {
  if (typeof window === "undefined") {
    return "light";
  }

  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return mode;
}

function applyThemeMode(mode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.resolvedTheme = resolveThemeMode(mode);
}

async function readErrorResponse(response) {
  try {
    const data = await response.json();
    return data?.error || JSON.stringify(data);
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

const initialState = {
  payload: null,
  payloadStatus: "Loading 3D HUD payload...",
  selectedFile: null,
  parsed: null,
  parseError: "",
  status: "Status: Ready",
  isBusy: false,
  isDragging: false,
  helperStatus: {
    available: false,
    message: "Checking local compiler helper..."
  }
};

function reducer(state, action) {
  switch (action.type) {
    case "payloadLoaded":
      return {
        ...state,
        payload: action.payload,
        payloadStatus: `Payload ready: ${action.payload.files.length} files, ${formatBytes(action.payload.totalBytes)}.`
      };
    case "payloadFailed":
      return {
        ...state,
        payload: null,
        payloadStatus: action.message
      };
    case "helperLoaded":
      return {
        ...state,
        helperStatus: {
          available: action.available,
          message: action.message
        }
      };
    case "parseStarted":
      return {
        ...state,
        selectedFile: action.file,
        parsed: null,
        parseError: "",
        isBusy: true,
        status: "Reading VPK..."
      };
    case "parseSucceeded":
      return {
        ...state,
        parsed: action.parsed,
        parseError: "",
        isBusy: false,
        status: `Parsed ${action.parsed.files.length} entries from ${action.fileName}.`
      };
    case "parseFailed":
      return {
        ...state,
        parsed: null,
        parseError: action.message,
        isBusy: false,
        status: action.message
      };
    case "busy":
      return {
        ...state,
        isBusy: action.value,
        status: action.status ?? state.status
      };
    case "drag":
      return {
        ...state,
        isDragging: action.value
      };
    case "status":
      return {
        ...state,
        status: action.status
      };
    default:
      return state;
  }
}

async function loadHelperStatus(signal) {
  const response = await fetch(compilerHelperEndpoint("/health"), { signal });
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  const data = await response.json();
  const available = !!data.compilerExists && !!data.sourceExists;
  return {
    available,
    message: available
      ? "Local compiler helper ready for layout/CSS conflicts."
      : "Local compiler helper is running, but its compiler or 3D HUD source path is missing."
  };
}

async function requestCompilerBackedMerge(file, options = {}) {
  const response = await fetch(compilerHelperEndpoint("/merge"), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": file.name,
      "X-Hud-Ui-Scale": String(normalizeHudUiScale(options.hudUiScale))
    },
    body: await file.arrayBuffer()
  });
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  const patchedPathsHeader = response.headers.get("X-Hud-Inject-Patched-Paths") || "";
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    patchedPaths: patchedPathsHeader.split(",").flatMap((path) => {
      const cleanPath = path.trim();
      return cleanPath ? [cleanPath] : [];
    })
  };
}

export default function HudInjectIsland() {
  const parseRunRef = useRef(0);
  const closeTutorialRef = useRef(null);
  const [themeMode, setThemeMode] = useState(getStoredThemeMode);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [hudUiScale, setHudUiScale] = useState(DEFAULT_HUD_UI_SCALE);
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    payload,
    payloadStatus,
    selectedFile,
    parsed,
    parseError,
    status,
    isBusy,
    isDragging,
    helperStatus
  } = state;

  useEffect(() => {
    let cancelled = false;
    loadHudPayload(import.meta.env.BASE_URL)
      .then((nextPayload) => {
        if (cancelled) return;
        dispatch({ type: "payloadLoaded", payload: nextPayload });
      })
      .catch((error) => {
        if (cancelled) return;
        dispatch({ type: "payloadFailed", message: error?.message || String(error) });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadHelperStatus(controller.signal)
      .then((nextHelperStatus) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "helperLoaded", ...nextHelperStatus });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "helperLoaded",
          available: false,
          message: "Local compiler helper offline. Start it with npm run helper for patchable layout/CSS conflicts."
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);

    if (themeMode !== "system" || typeof window === "undefined") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => applyThemeMode("system");
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [themeMode]);

  useEffect(() => {
    if (!isTutorialOpen || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeTutorialRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsTutorialOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTutorialOpen]);

  const activePayload = payload;
  const activePayloadStatus = activePayload ? `Payload ready: ${activePayload.files.length} files, ${formatBytes(activePayload.totalBytes)}. HUD UI scale ${hudUiScale}%.` : payloadStatus;
  const scaleRequiresCompiler = requiresCompilerForHudUiScale(hudUiScale);
  const uploadedHasBaseCssFolder = useMemo(() => hasCssHijackBaseFolder(parsed?.files), [parsed]);

  const browserPlan = useMemo(() => {
    if (!parsed || !activePayload) return null;
    return resolveHudPayloadConflicts(parsed.files, activePayload.files, {
      hudProbeSource: activePayload.hudProbeSource
    });
  }, [parsed, activePayload]);

  const compilerPlan = useMemo(() => {
    if (!parsed || !activePayload || (browserPlan?.files && !scaleRequiresCompiler)) return null;
    return createCompilerBackedHudMergePlan(parsed.files, activePayload.files, {
      hudProbeSource: activePayload.hudProbeSource,
      hudUiScale
    });
  }, [parsed, activePayload, browserPlan, scaleRequiresCompiler, hudUiScale]);

  const requiresCompilerHelper = !!compilerPlan && (!browserPlan?.files || scaleRequiresCompiler) && compilerPlan.blockedConflicts.length === 0;
  const displayPlan = requiresCompilerHelper ? compilerPlan : browserPlan;
  const visibleConflicts = displayPlan?.conflicts || [];
  const blockedConflicts = displayPlan?.blockedConflicts || [];
  const patchedPaths = displayPlan?.patchedPaths || [];
  const canMerge =
    !!selectedFile &&
    !!parsed &&
    !!activePayload &&
    !parseError &&
    !isBusy &&
    ((!!browserPlan?.files && !scaleRequiresCompiler) || (requiresCompilerHelper && helperStatus.available));
  const isPatchReady = patchedPaths.length > 0 && blockedConflicts.length === 0;
  const buttonLabel = requiresCompilerHelper && !helperStatus.available
    ? "Start Helper to Patch"
    : (requiresCompilerHelper ? "Compiler Patch + Repack VPK" : (isPatchReady ? "Patch + Repack VPK" : "Repack VPK"));
  const hasScanResult = !!parsed && !!activePayload && !parseError;
  const resultTone = blockedConflicts.length > 0
    ? "danger"
    : (hasScanResult && (requiresCompilerHelper || isPatchReady) ? "patch" : (hasScanResult ? "safe" : "idle"));
  const resultTitle = parseError
    ? "Upload needs attention"
    : (blockedConflicts.length > 0
      ? "Some paths still need a rule"
      : (requiresCompilerHelper
        ? (scaleRequiresCompiler ? "Ready for compiler scaling" : "Ready for compiler patching")
        : (hasScanResult && isPatchReady
          ? "Ready to patch in browser"
          : (hasScanResult ? "Ready to merge" : "Choose a VPK to begin"))));
  const resultCopy = parseError
    ? parseError
    : (blockedConflicts[0]?.reason || (requiresCompilerHelper
      ? "The local helper will patch source, recompile the compiled HUD files, then repack the uploaded addon."
      : (hasScanResult && isPatchReady
        ? "Supported conflicts will be patched in place before the merged VPK downloads."
        : (hasScanResult
          ? "No payload path blocks the merge. The download will keep existing files and add the 3D HUD payload."
          : "The tool reads the uploaded addon locally and shows whether it can merge, patch, or needs the compiler helper."))));
  const helperCommandVisible = requiresCompilerHelper && !helperStatus.available;
  const selectedFileText = selectedFile ? `${selectedFile.name} - ${formatBytes(selectedFile.size)}` : "No VPK selected";
  const actionHelp = isBusy
    ? "Working on the uploaded VPK..."
    : (canMerge ? "Builds and downloads a merged copy. The original file is not changed." : "Choose a VPK and wait for readiness checks.");
  const tutorialGifUrl = joinAssetPath(import.meta.env.BASE_URL, TUTORIAL_GIF_PATH);

  async function parseFile(file) {
    const runId = parseRunRef.current + 1;
    parseRunRef.current = runId;
    const isCurrentRun = () => parseRunRef.current === runId;

    dispatch({ type: "parseStarted", file: file || null });
    try {
      if (!file) throw new Error("No VPK selected");
      if (!file.name.toLowerCase().endsWith(".vpk")) {
        throw new Error("Selected file must end with .vpk");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrentRun()) return;
      const nextParsed = parseVpk(bytes);
      if (!isCurrentRun()) return;
      dispatch({ type: "parseSucceeded", parsed: nextParsed, fileName: file.name });
    } catch (error) {
      if (!isCurrentRun()) return;
      const message = error?.message || String(error);
      dispatch({ type: "parseFailed", message });
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    await parseFile(file);
  }

  async function handleDrop(event) {
    event.preventDefault();
    dispatch({ type: "drag", value: false });
    await parseFile(event.dataTransfer.files?.[0] || null);
  }

  function handleDragOver(event) {
    event.preventDefault();
    dispatch({ type: "drag", value: true });
  }

  function handleDragLeave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      dispatch({ type: "drag", value: false });
    }
  }

  async function handleBuild() {
    if (!selectedFile || !parsed || !activePayload) return;
    if (requiresCompilerHelper && !helperStatus.available) {
      dispatch({ type: "status", status: helperStatus.message });
      return;
    }
    dispatch({
      type: "busy",
      value: true,
      status: requiresCompilerHelper ? "Patching with local Source 2 compiler..." : "Packing merged VPK..."
    });
    try {
      const mergePlan = resolveHudPayloadConflicts(parsed.files, activePayload.files, {
        hudProbeSource: activePayload.hudProbeSource
      });
      if (mergePlan.files && mergePlan.blockedConflicts.length === 0 && !scaleRequiresCompiler) {
        const bytes = writeVpk(mergePlan.files);
        downloadBytes(outputFilename(selectedFile.name), bytes);
        const patchText = mergePlan.patchedPaths.length > 0 ? " Patched supported conflicts." : "";
        dispatch({ type: "status", status: `Built ${outputFilename(selectedFile.name)} (${formatBytes(bytes.byteLength)}).${patchText}` });
        return;
      }

      const compilerMergePlan = createCompilerBackedHudMergePlan(parsed.files, activePayload.files, {
        hudProbeSource: activePayload.hudProbeSource,
        hudUiScale
      });
      if (!compilerMergePlan.files || compilerMergePlan.blockedConflicts.length > 0) {
        const count = mergePlan.blockedConflicts.length || mergePlan.conflicts.length;
        throw new Error(`Blocked by ${count} unresolved conflicting path${count === 1 ? "" : "s"}`);
      }

      const result = await requestCompilerBackedMerge(selectedFile, { hudUiScale });
      downloadBytes(outputFilename(selectedFile.name), result.bytes);
      const patchText = result.patchedPaths.length > 0
        ? ` Compiler patched ${result.patchedPaths.length} compiled conflict${result.patchedPaths.length === 1 ? "" : "s"}.`
        : "";
      dispatch({ type: "status", status: `Built ${outputFilename(selectedFile.name)} (${formatBytes(result.bytes.byteLength)}).${patchText}` });
    } catch (error) {
      dispatch({ type: "status", status: error?.message || String(error) });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }

  function handleThemeModeChange(nextThemeMode) {
    if (nextThemeMode === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode);
    }
    setThemeMode(nextThemeMode);
  }

  return (
    <section className="injector" aria-label="3D HUD VPK merger">
      <HeroPanel
        helperStatus={helperStatus}
        onTutorialOpen={() => setIsTutorialOpen(true)}
        onThemeModeChange={handleThemeModeChange}
        payload={payload}
        themeMode={themeMode}
      />
      <CommandPanel
        actionHelp={actionHelp}
        buttonLabel={buttonLabel}
        canMerge={canMerge}
        handleBuild={handleBuild}
        handleDragLeave={handleDragLeave}
        handleDragOver={handleDragOver}
        handleDrop={handleDrop}
        handleFileChange={handleFileChange}
        helperCommandVisible={helperCommandVisible}
        hudUiScale={hudUiScale}
        isDragging={isDragging}
        onHudUiScaleChange={(value) => setHudUiScale(normalizeHudUiScale(value))}
        selectedFileText={selectedFileText}
      />
      <ResultPanel
        blockedConflicts={blockedConflicts}
        hasScanResult={hasScanResult}
        helperStatus={helperStatus}
        isPatchReady={isPatchReady}
        parsed={parsed}
        parseError={parseError}
        payload={activePayload}
        payloadStatus={activePayloadStatus}
        requiresCompilerHelper={requiresCompilerHelper}
        resultCopy={resultCopy}
        resultTitle={resultTitle}
        resultTone={resultTone}
        status={status}
        uploadedHasBaseCssFolder={uploadedHasBaseCssFolder}
        visibleConflicts={visibleConflicts}
      />
      <PageFooter />
      <TutorialDialog
        closeButtonRef={closeTutorialRef}
        gifUrl={tutorialGifUrl}
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
      />
    </section>
  );
}

function ThemeSwitcher({ value, onChange }) {
  const options = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" }
  ];

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "theme-choice is-active" : "theme-choice"}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PageFooter() {
  return (
    <footer className="page-footer" aria-label="Project notices">
      <p>
        Unofficial fan-made tool. Not affiliated with Valve. Runs locally; VPKs are not uploaded. Built by{" "}
        <a href="https://github.com/Hantu-Raya" target="_blank" rel="noreferrer">Hantu-Raya</a>.
        {" "}Source on{" "}
        <a href="https://github.com/Hantu-Raya/3d-hud-web-merger" target="_blank" rel="noreferrer">GitHub</a>.
        {" "}Apache-2.0 licensed; see LICENSE and NOTICE.
      </p>
    </footer>
  );
}

function HeroPanel({ helperStatus, onTutorialOpen, onThemeModeChange, payload, themeMode }) {
  return (
    <header className="hero-panel">
      <div className="hero-copy">
        <p className="eyebrow">Deadlock addon merge</p>
        <h1>3D HUD VPK Merger</h1>
        <p className="hero-text">
          Merge the compiled 3D HUD payload into an existing addon VPK. The browser checks paths first; the helper only steps in when compiled layout or CSS patching is needed.
        </p>
        <div className="related-tools" aria-label="Similar Hantu-Raya tools">
          <span className="related-tools-label">Similar tools</span>
          <a className="related-tool-button" href="https://hantu-raya.github.io/color-blind-web-builder/" target="_blank" rel="noreferrer">
            Color Blind Builder
          </a>
          <a className="related-tool-button" href="https://hantu-raya.github.io/hp-colors-preset-builder/" target="_blank" rel="noreferrer">
            HP Colors Preset Builder
          </a>
        </div>
      </div>

      <div className="hero-actions">
        <div className="hero-action-buttons">
          <a className="support-button" href="https://ko-fi.com/hantuaraya" target="_blank" rel="noreferrer">
            <HeartIcon />
            <span>Support development</span>
          </a>

          <button className="tutorial-button" type="button" onClick={onTutorialOpen}>
            <PlayIcon />
            <span>Watch tutorial</span>
          </button>
        </div>

        <div className="readiness" aria-label="Readiness checks">
          <StatusBadge label="Payload" value={payload ? "Ready" : "Loading"} tone={payload ? "good" : "warn"} />
          <StatusBadge label="Helper" value={helperStatus.available ? "Ready" : "Offline"} tone={helperStatus.available ? "good" : "warn"} />
        </div>

        <ThemeSwitcher value={themeMode} onChange={onThemeModeChange} />
      </div>
    </header>
  );
}

function PlayIcon() {
  return (
    <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.25 5.75v12.5L18 12 8.25 5.75Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="close-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.75 6.75 10.5 10.5m0-10.5-10.5 10.5" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg className="support-heart" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.8 10.8 19.7C5.9 15.2 2.8 12.4 2.8 8.9 2.8 6.1 5 4 7.7 4c1.6 0 3.2.8 4.3 2 1.1-1.2 2.7-2 4.3-2 2.7 0 4.9 2.1 4.9 4.9 0 3.5-3.1 6.3-8 10.8L12 20.8Z" />
    </svg>
  );
}

function TutorialDialog({ closeButtonRef, gifUrl, isOpen, onClose }) {
  if (!isOpen) {
    return null;
  }

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div className="tutorial-overlay" role="presentation" onMouseDown={handleOverlayClick}>
      <section
        className="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-copy"
      >
        <div className="tutorial-header">
          <div>
            <p className="section-label">Tutorial</p>
            <h2 id="tutorial-title">How to merge a VPK</h2>
          </div>
          <button ref={closeButtonRef} className="modal-close" type="button" onClick={onClose} aria-label="Close tutorial">
            <CloseIcon />
          </button>
        </div>
        <p id="tutorial-copy" className="tutorial-copy">
          Choose an addon VPK, wait for the checks, then repack a merged copy. Your original file stays unchanged.
        </p>
        <div className="tutorial-media">
          <img src={gifUrl} alt="Animated walkthrough showing the VPK merge flow" />
        </div>
      </section>
    </div>
  );
}

function CommandPanel({
  actionHelp,
  buttonLabel,
  canMerge,
  handleBuild,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleFileChange,
  helperCommandVisible,
  hudUiScale,
  isDragging,
  onHudUiScaleChange,
  selectedFileText
}) {
  return (
    <div className="command-panel">
      <div className="command-main">
        <label
          className={isDragging ? "file-command is-dragging" : "file-command"}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input type="file" accept=".vpk" onChange={handleFileChange} />
          <span className="file-label">Choose VPK</span>
          <span className="file-name">{selectedFileText}</span>
        </label>

        <button type="button" className="primary-action" disabled={!canMerge} onClick={handleBuild}>
          <span>{buttonLabel}</span>
          <span aria-hidden="true" className="button-mark">+</span>
        </button>
      </div>

      <div className="scale-control">
        <span className="scale-copy">
          <label className="scale-label" htmlFor="hud-ui-scale">HUD UI scale</label>
          <span id="hud-ui-scale-help" className="scale-help">170 is browser-ready. Other values use the local helper for real compiled CSS.</span>
        </span>
        <span className="scale-input-row">
          <input
            id="hud-ui-scale"
            type="range"
            min={MIN_HUD_UI_SCALE}
            max={MAX_HUD_UI_SCALE}
            step="1"
            value={hudUiScale}
            aria-describedby="hud-ui-scale-help"
            onChange={(event) => onHudUiScaleChange(event.target.value)}
          />
          <strong>{hudUiScale}%</strong>
        </span>
      </div>

      <p className="action-help">{actionHelp}</p>

      {helperCommandVisible ? (
        <div className="helper-callout" role="note">
          <span>Compiler helper required for this VPK.</span>
          <kbd>npm run helper</kbd>
        </div>
      ) : null}
    </div>
  );
}

function ResultPanel({
  blockedConflicts,
  hasScanResult,
  helperStatus,
  isPatchReady,
  parsed,
  parseError,
  payload,
  payloadStatus,
  requiresCompilerHelper,
  resultCopy,
  resultTitle,
  resultTone,
  status,
  uploadedHasBaseCssFolder,
  visibleConflicts
}) {
  const stateText = blockedConflicts.length > 0
    ? "Blocked"
    : (hasScanResult ? (requiresCompilerHelper || isPatchReady ? "Patchable" : "Safe") : "Waiting");

  return (
    <section className={`result-card result-${resultTone}`} aria-label="Merge result">
      <div className="result-heading">
        <div>
          <p className="section-label">Result</p>
          <h2>{resultTitle}</h2>
        </div>
        <span className={`state-chip state-${resultTone}`}>{stateText}</span>
      </div>

      <p className="result-copy">{resultCopy}</p>

      <div className="summary-grid" aria-label="VPK summary">
        <SummaryMetric label="Uploaded entries" value={parsed ? parsed.files.length.toLocaleString() : "-"} />
        <SummaryMetric label="Payload files" value={payload ? payload.files.length.toLocaleString() : "-"} />
        <SummaryMetric label="Conflicts" value={hasScanResult ? visibleConflicts.length.toLocaleString() : "-"} />
        <SummaryMetric label="Mode" value={requiresCompilerHelper ? "Compiler" : (isPatchReady ? "Browser patch" : "Browser merge")} />
      </div>

      <div className="status-list" role="status" aria-live="polite">
        <StatusLine tone={parseError ? "bad" : "neutral"}>{status}</StatusLine>
        <StatusLine tone={payload ? "good" : "warn"}>{payloadStatus}</StatusLine>
        <StatusLine tone={helperStatus.available ? "good" : "warn"}>{helperStatus.message}</StatusLine>
        {hasScanResult && uploadedHasBaseCssFolder ? (
          <StatusLine tone="neutral">Base CSS folder detected; exact 3D HUD base paths will be reused and missing base CSS will be added.</StatusLine>
        ) : null}
      </div>

      <ConflictDetails conflicts={visibleConflicts} />
    </section>
  );
}

function ConflictDetails({ conflicts }) {
  if (conflicts.length === 0) {
    return null;
  }

  return (
    <details className="technical-details">
      <summary>View {conflicts.length.toLocaleString()} path detail{conflicts.length === 1 ? "" : "s"}</summary>
      <div className="conflict-table-wrap">
        <table className="conflict-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Existing</th>
              <th>Payload</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict) => (
              <tr key={`${conflict.existingPath}:${conflict.payloadPath}`}>
                <td>{conflict.path}</td>
                <td>{conflict.existingPath}</td>
                <td>{conflict.payloadPath}</td>
                <td>{conflict.resolution || conflict.reason || "Blocked"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function StatusBadge({ label, value, tone }) {
  return (
    <div className={`status-badge status-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusLine({ tone, children }) {
  return (
    <p className={`status-line status-line-${tone}`}>{children}</p>
  );
}
