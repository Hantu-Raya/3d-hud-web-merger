import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { downloadBytes } from "../download.js";
import { resolveHudPayloadConflicts } from "../hudConflictResolver.js";
import { loadHudPayload, loadHudScaleVariant } from "../hudPayload.js";
import {
  applyHudUiScalePayloadFiles,
  DEFAULT_HUD_UI_SCALE,
  MAX_HUD_UI_SCALE,
  MIN_HUD_UI_SCALE,
  normalizeHudUiScale
} from "../hudPayloadOptions.js";
import { parseVpk } from "../vpkReader.js";
import { writeVpk } from "../vpkWriter.js";
import { buildGitCommitInfoRequestUrl, isGitCommitInfoPayload } from "../gitCommitInfoRefresh.js";

const THEME_STORAGE_KEY = "3d-hud-theme-mode";
const TUTORIAL_GIF_PATH = "demo/usage-demo.gif";

function joinAssetPath(baseUrl, path) {
  const base = String(baseUrl || "/");
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  return `${cleanBase}${String(path || "").replace(/^\/+/, "")}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function shortCommit(value) {
  return String(value || "").slice(0, 12) || "-";
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

const initialState = {
  payload: null,
  payloadStatus: "Loading 3D HUD payload...",
  selectedFile: null,
  parsed: null,
  parseError: "",
  status: "Status: Ready",
  isBusy: false,
  isDragging: false
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

export default function HudInjectIsland({ gitCommitInfo = null }) {
  const parseRunRef = useRef(0);
  const closeTutorialRef = useRef(null);
  const scaleVariantCacheRef = useRef(new Map([[String(DEFAULT_HUD_UI_SCALE), new Map()]]));
  const [themeMode, setThemeMode] = useState(getStoredThemeMode);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [hudUiScale, setHudUiScale] = useState(DEFAULT_HUD_UI_SCALE);
  const [freshGitCommitInfo, setFreshGitCommitInfo] = useState(null);
  const [scaleVariant, setScaleVariant] = useState({
    error: "",
    filesByPath: new Map(),
    isLoading: false,
    scale: DEFAULT_HUD_UI_SCALE
  });
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    payload,
    payloadStatus,
    selectedFile,
    parsed,
    parseError,
    status,
    isBusy,
    isDragging
  } = state;
  const activeGitCommitInfo = freshGitCommitInfo || gitCommitInfo;

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
    let ignore = false;
    const refreshCommitInfo = async () => {
      try {
        const response = await fetch(buildGitCommitInfoRequestUrl(import.meta.env.BASE_URL), { cache: "no-store" });
        if (!response.ok) return;
        const nextGitCommitInfo = await response.json();
        if (!ignore && isGitCommitInfoPayload(nextGitCommitInfo)) {
          setFreshGitCommitInfo(nextGitCommitInfo);
        }
      } catch {
        // Keep the statically embedded commit info when the refresh endpoint is unavailable.
      }
    };
    refreshCommitInfo();
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!payload) return undefined;

    let ignore = false;
    const scale = normalizeHudUiScale(hudUiScale);
    const cached = scaleVariantCacheRef.current.get(String(scale));
    if (cached) {
      setScaleVariant({
        error: "",
        filesByPath: cached,
        isLoading: false,
        scale
      });
      return () => { ignore = true; };
    }

    setScaleVariant({
      error: "",
      filesByPath: new Map(),
      isLoading: true,
      scale
    });

    loadHudScaleVariant(import.meta.env.BASE_URL, payload.manifest, scale)
      .then((filesByPath) => {
        if (ignore) return;
        scaleVariantCacheRef.current.set(String(scale), filesByPath);
        setScaleVariant({
          error: "",
          filesByPath,
          isLoading: false,
          scale
        });
      })
      .catch((error) => {
        if (ignore) return;
        setScaleVariant({
          error: error?.message || String(error),
          filesByPath: new Map(),
          isLoading: false,
          scale
        });
      });

    return () => { ignore = true; };
  }, [payload, hudUiScale]);

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

  const scaleVariantPending = !!payload && (scaleVariant.scale !== hudUiScale || scaleVariant.isLoading);
  const scaleVariantError = scaleVariant.scale === hudUiScale ? scaleVariant.error : "";
  const scaleReady = !!payload && scaleVariant.scale === hudUiScale && !scaleVariant.isLoading && !scaleVariantError;
  const activePayloadFiles = useMemo(() => {
    if (!payload || !scaleReady) return null;
    return applyHudUiScalePayloadFiles(payload.files, scaleVariant.filesByPath);
  }, [payload, scaleReady, scaleVariant.filesByPath]);
  const activePayloadStatus = payload
    ? (scaleVariantError
      ? scaleVariantError
      : (scaleVariantPending
        ? `Loading compiled HUD UI scale ${hudUiScale}%...`
        : `Payload ready: ${payload.files.length} files, HUD UI scale ${hudUiScale}%.`))
    : payloadStatus;
  const scaleStatusLabel = scaleVariantError
    ? "Error"
    : (scaleVariantPending ? "Loading" : `${hudUiScale}%`);
  const scaleStatusTone = scaleVariantError ? "warn" : (scaleVariantPending ? "warn" : "good");

  const browserPlan = useMemo(() => {
    if (!parsed || !payload || !activePayloadFiles) return null;
    return resolveHudPayloadConflicts(parsed.files, activePayloadFiles, {
      hudProbeSource: payload.hudProbeSource,
      knownScaleVariantSignaturesByPath: payload.knownScaleVariantSignaturesByPath
    });
  }, [parsed, payload, activePayloadFiles]);

  const visibleConflicts = browserPlan?.conflicts || [];
  const blockedConflicts = browserPlan?.blockedConflicts || [];
  const patchedPaths = browserPlan?.patchedPaths || [];
  const canMerge =
    !!selectedFile &&
    !!parsed &&
    !!payload &&
    !!activePayloadFiles &&
    !parseError &&
    !isBusy &&
    !scaleVariantError &&
    !!browserPlan?.files &&
    blockedConflicts.length === 0;
  const isPatchReady = patchedPaths.length > 0 && blockedConflicts.length === 0;
  const buttonLabel = isPatchReady ? "Patch + Repack VPK" : "Repack VPK";
  const hasScanResult = !!parsed && !!payload && !parseError;
  const resultTone = blockedConflicts.length > 0
    ? "danger"
    : (hasScanResult && isPatchReady ? "patch" : (hasScanResult ? "safe" : "idle"));
  const resultTitle = parseError
    ? "Upload needs attention"
    : (blockedConflicts.length > 0
      ? "Some paths still need a rule"
      : (scaleVariantError
        ? "HUD UI scale needs attention"
        : (scaleVariantPending
          ? "Loading compiled scale variant"
          : (hasScanResult && isPatchReady
            ? "Ready to patch in browser"
            : (hasScanResult ? "Ready to merge" : "Choose a VPK to begin")))));
  const resultCopy = parseError
    ? parseError
    : (scaleVariantError || blockedConflicts[0]?.reason || (hasScanResult && isPatchReady
      ? "Supported conflicts will be patched in place before the merged VPK downloads."
      : (hasScanResult
        ? "No payload path blocks the merge. The download will keep existing files and add the 3D HUD payload."
        : "The tool reads the uploaded addon locally and merges the selected compiled HUD scale variant in browser.")));
  const selectedFileText = selectedFile ? `${selectedFile.name} - ${formatBytes(selectedFile.size)}` : "No VPK selected";
  const actionHelp = isBusy
    ? "Working on the uploaded VPK..."
    : (scaleVariantPending
      ? "Loading the selected compiled HUD UI scale variant..."
      : (canMerge ? "Builds and downloads a merged copy. The original file is not changed." : "Choose a VPK and wait for readiness checks."));
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
    if (!selectedFile || !parsed || !payload || !activePayloadFiles) return;
    dispatch({
      type: "busy",
      value: true,
      status: "Packing merged VPK..."
    });
    try {
      const mergePlan = resolveHudPayloadConflicts(parsed.files, activePayloadFiles, {
        hudProbeSource: payload.hudProbeSource,
        knownScaleVariantSignaturesByPath: payload.knownScaleVariantSignaturesByPath
      });
      if (mergePlan.files && mergePlan.blockedConflicts.length === 0) {
        const bytes = writeVpk(mergePlan.files);
        downloadBytes(outputFilename(selectedFile.name), bytes);
        const patchText = mergePlan.patchedPaths.length > 0 ? " Patched supported conflicts." : "";
        dispatch({ type: "status", status: `Built ${outputFilename(selectedFile.name)} (${formatBytes(bytes.byteLength)}).${patchText}` });
        return;
      }

      const count = mergePlan.blockedConflicts.length || mergePlan.conflicts.length;
      throw new Error(`Blocked by ${count} unresolved conflicting path${count === 1 ? "" : "s"}`);
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
        gitCommitInfo={activeGitCommitInfo}
        onTutorialOpen={() => setIsTutorialOpen(true)}
        onThemeModeChange={handleThemeModeChange}
        payload={payload}
        scaleStatusLabel={scaleStatusLabel}
        scaleStatusTone={scaleStatusTone}
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
        hudUiScale={hudUiScale}
        isDragging={isDragging}
        onHudUiScaleChange={(value) => setHudUiScale(normalizeHudUiScale(value))}
        selectedFileText={selectedFileText}
      />
      <ResultPanel
        blockedConflicts={blockedConflicts}
        hasScanResult={hasScanResult}
        isPatchReady={isPatchReady}
        parsed={parsed}
        parseError={parseError}
        payload={payload}
        payloadStatus={activePayloadStatus}
        resultCopy={resultCopy}
        resultTitle={resultTitle}
        resultTone={resultTone}
        status={status}
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

function HeroPanel({ gitCommitInfo, onTutorialOpen, onThemeModeChange, payload, scaleStatusLabel, scaleStatusTone, themeMode }) {
  return (
    <header className="hero-panel">
      <div className="hero-copy">
        <p className="eyebrow">Deadlock addon merge</p>
        <div className="hero-title-row">
          <h1>3D HUD VPK Merger</h1>
          {gitCommitInfo?.url && gitCommitInfo?.shortHash ? (
            <a
              className="commit-version-link"
              href={gitCommitInfo.url}
              target="_blank"
              rel="noreferrer"
              aria-label={gitCommitInfo.title || `Latest commit ${gitCommitInfo.shortHash}`}
              data-tooltip={gitCommitInfo.title || `Latest commit ${gitCommitInfo.shortHash}`}
            >
              <CommitIcon />
              <span>Commit</span>
              <code>{gitCommitInfo.shortHash}</code>
            </a>
          ) : null}
        </div>
        <p className="hero-text">
          Merge the compiled 3D HUD payload into an existing addon VPK. The browser checks paths first and uses precompiled scale variants for every HUD UI scale value.
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
          <div className="support-star-combo" aria-label="Support and repository actions">
            <a className="support-button" href="https://ko-fi.com/hantuaraya" target="_blank" rel="noreferrer">
              <HeartIcon />
              <span>Support development</span>
            </a>

            <a className="star-repo-button" href="https://github.com/Hantu-Raya/3d-hud-web-merger" target="_blank" rel="noreferrer" aria-label="Star the repository on GitHub">
              <StarIcon />
              <span>Star</span>
            </a>
          </div>

          <button className="tutorial-button" type="button" onClick={onTutorialOpen}>
            <PlayIcon />
            <span>Watch tutorial</span>
          </button>
        </div>

        <div className="readiness" aria-label="Readiness checks">
          <StatusBadge label="Payload" value={payload ? "Ready" : "Loading"} tone={payload ? "good" : "warn"} />
          <StatusBadge label="Scale" value={scaleStatusLabel} tone={scaleStatusTone} />
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

function CommitIcon() {
  return (
    <svg className="commit-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.25 7.5a2.75 2.75 0 1 1 3.98 2.46l2.94 4.08a2.8 2.8 0 0 1 1.08-.22c.35 0 .69.07 1 .19l2.79-3.89a2.75 2.75 0 1 1 1.39 1l-2.79 3.89a2.75 2.75 0 1 1-4.86.03L8.84 10.96A2.75 2.75 0 0 1 6.25 7.5Z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="star-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3.7 2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 15.68l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76L12 3.7Z" />
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
          <span id="hud-ui-scale-help" className="scale-help">Every value uses a real precompiled Source 2 CSS variant and merges locally in browser.</span>
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
    </div>
  );
}

function ResultPanel({
  blockedConflicts,
  hasScanResult,
  isPatchReady,
  parsed,
  parseError,
  payload,
  payloadStatus,
  resultCopy,
  resultTitle,
  resultTone,
  status,
  visibleConflicts
}) {
  const stateText = blockedConflicts.length > 0
    ? "Blocked"
    : (hasScanResult ? (isPatchReady ? "Patchable" : "Safe") : "Waiting");

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
        <SummaryMetric label="Mode" value={isPatchReady ? "Browser patch" : "Browser merge"} />
      </div>

      <div className="status-list" role="status" aria-live="polite">
        <StatusLine tone={parseError ? "bad" : "neutral"}>{status}</StatusLine>
        <StatusLine tone={payload ? "good" : "warn"}>{payloadStatus}</StatusLine>
      </div>

      <PayloadVersionPanel payload={payload} />

      <ConflictDetails conflicts={visibleConflicts} />
    </section>
  );
}

function PayloadVersionPanel({ payload }) {
  const manifest = payload?.manifest || {};
  const scriptName = manifest.scriptCompiledPath || "panorama/scripts/3d_hero_dynamic.vjs_c";
  const scriptCommit = manifest.scriptSourceCommit || manifest.sourceCommit || "";
  const payloadCommit = manifest.sourceCommit || "";
  const sourcePath = manifest.scriptSourcePath || "3d hud/panorama/scripts/3d_hero_dynamic.js";
  const scriptSource = manifest.scriptSource || manifest.source || "";

  return (
    <section className="version-panel" aria-label="3D HUD version">
      <div className="version-heading">
        <div>
          <p className="section-label">3D HUD version</p>
          <h3>Dynamic script in this build</h3>
        </div>
        <code>{shortCommit(scriptCommit)}</code>
      </div>

      <dl className="version-list">
        <div>
          <dt>Compiled file</dt>
          <dd>{scriptName}</dd>
        </div>
        <div>
          <dt>Original script</dt>
          <dd>
            {scriptSource ? (
              <a href={scriptSource} target="_blank" rel="noreferrer">{sourcePath}</a>
            ) : sourcePath}
          </dd>
        </div>
        <div>
          <dt>Original script commit</dt>
          <dd>
            {scriptSource ? (
              <a href={scriptSource} target="_blank" rel="noreferrer">{scriptCommit || "-"}</a>
            ) : (scriptCommit || "-")}
          </dd>
        </div>
        <div>
          <dt>Payload snapshot</dt>
          <dd>{payloadCommit || "-"}</dd>
        </div>
      </dl>
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

function StatusBadge({ actionLabel = "", label, onAction = null, value, tone }) {
  return (
    <div className={`status-badge status-${tone}`}>
      <span>{label}</span>
      {onAction ? (
        <button type="button" className="status-action" onClick={onAction} aria-label={`${actionLabel} ${label.toLowerCase()}`}>
          {actionLabel}
        </button>
      ) : (
        <strong>{value}</strong>
      )}
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
