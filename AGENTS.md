# AGENTS GUIDE (3D HUD VPK Merger)

## Scope
This guide applies to `D:\web\3d-hud-web-inject`.

This is a standalone Astro + React browser tool for merging the compiled 3D HUD payload into a locally selected Deadlock addon VPK. It is not part of `D:\web\Movie` or `D:\web\Web-tools`; do not apply their Bun, Next.js, or zero-build assumptions here.

Nearest guide wins. If a more specific `AGENTS.md` is added later, follow that file for its subtree.

## Project Shape
```text
D:\web\3d-hud-web-inject\
├── src/
│   ├── components/HudInjectIsland.jsx   # Main React workflow and UI state
│   ├── pages/index.astro                # Astro page shell and metadata
│   ├── styles/global.css                # Full app styling and themes
│   ├── vpkReader.js                     # VPK v2 reader for embedded data
│   ├── vpkWriter.js                     # VPK writer for merged output
│   ├── vpkMerge.js                      # Path normalization and merge helpers
│   ├── hudConflictResolver.js           # Browser-side safe conflict patch rules
│   ├── compilerBackedMerge.js           # Source-patch plan for helper recompiles
│   ├── hudLayoutPatch.js                # hud.vxml_c XML patching logic
│   ├── hudHealthPatch.js                # hud_health.vxml_c patching logic
│   ├── hudStylePatch.js                 # CSS merge/patch logic
│   ├── source2ResourceReader.js         # Compiled Source 2 resource decompile helpers
│   ├── source2ResourceWriter.js         # Minimal compiled resource writer helpers
│   └── source2TextResource.js           # Compiled text resource helpers
├── public/
│   ├── demo/usage-demo.gif
│   └── payload/3d-hud/                  # Bundled compiled 3D HUD payload
├── scripts/
│   ├── local-compiler-helper.mjs        # Local localhost helper for compiler-backed patching
│   ├── sync-3d-hud-payload.mjs          # Downloads latest raw payload, terser-minifies JS, compiles _c files
│   └── create-demo-gif.mjs              # Regenerates README/tutorial demo GIF
├── test/                                # node:test coverage
└── .github/workflows/deploy-pages.yml   # GitHub Pages deploy workflow
```

## Commands
Run these from `D:\web\3d-hud-web-inject`.

```bash
npm install
npm run dev
npm run helper
npm run payload:sync
npm run demo:gif
npm test
npm run build
npm run check
npx -y react-doctor@latest . --json --offline
node --check scripts/local-compiler-helper.mjs
```

Local dev usually opens at:

```text
http://127.0.0.1:4328/3d-hud-web-merger/
```

The local compiler helper listens on:

```text
http://127.0.0.1:4329
```

Production Pages URL:

```text
https://hantu-raya.github.io/3d-hud-web-merger/
```

## Verification Expectations
For code changes, run:

```bash
npm run check
```

For React/UI changes, also run:

```bash
npx -y react-doctor@latest . --json --offline
```

For helper changes, also run:

```bash
node --check scripts/local-compiler-helper.mjs
```

For user-facing browser changes, verify in the in-app browser when practical. Check desktop and a narrow mobile width for no horizontal overflow, visible primary action, usable tutorial modal, and readable dark/light/system theme states.

Markdown-only changes do not require the full test suite unless they affect scripts, examples, or deployment instructions.

## Core Behavior Rules
- Keep VPK processing privacy-first. The hosted web app reads selected files locally in the browser; it must not upload VPKs to a remote server.
- The optional compiler helper is local-only and should bind to `127.0.0.1`.
- Browser-only merge is allowed when paths do not conflict or when a supported browser-safe patch rule exists.
- Compiled layout conflicts should use compiler-backed patching unless a test proves browser output is safe. Avoid reintroducing browser DATA-only `vxml_c` output paths that can crash Deadlock.
- Preserve user VPK content whenever patching. Add only required 3D HUD content, keep existing files and user scripts/styles where the patch rules support it, and block or clearly report unsupported conflicts.
- Never silently overwrite the original selected VPK. Downloads should remain merged copies, usually `merged-<original-name>.vpk`.

## Payload Rules
- The bundled payload lives under `public/payload/3d-hud/` and is the runtime source of truth.
- `public/payload/3d-hud/manifest.json` must list every payload file and keep paths unique after normalization.
- `npm run payload:sync` pulls from `Hantu-Raya/Deadlock-mods-collection`, minifies `panorama/scripts/3d_hero_dynamic.js` with Terser, compiles raw files into `_c`, preserves the compatibility `hud_health_container.vxml_c` file when needed, and records the upstream commit.
- If payload files change, update tests and verify the manifest integrity test.
- Do not hand-edit compiled payload files unless the user explicitly asks and there is no safer source-based path.

## Source 2 / VPK Constraints
- `vpkReader.js` supports VPK v2 `_dir.vpk` files with embedded file data. External archive entries are intentionally rejected.
- `vpkWriter.js` writes fresh VPKs and does not preserve optional MD5/signature metadata.
- Path comparisons should use slash normalization and case-insensitive matching through `normalizeVpkPath`.
- Keep binary parsing defensive: reject malformed trees, duplicate normalized paths, out-of-bounds file data, unsupported versions, and external archive entries.
- Add focused fixtures through `writeVpk` for reader/merge tests instead of committing large arbitrary VPKs.

## UI / UX Rules
- The app is a compact single-command tool, not a landing page.
- Keep the primary flow visible: choose VPK, see status, repack/download.
- Theme mode defaults to system and offers system/light/dark in the header.
- Keep conflict detail behind disclosure unless it is the main actionable result.
- Use warm minimalist styling already in `src/styles/global.css`; avoid gradients, heavy shadows, decorative blobs, oversized marketing sections, and unrelated UI dependencies.
- Donation/support and tutorial actions live in the header and should not compete with the file/merge command.
- Maintain footer legal copy: unofficial fan-made tool, not affiliated with Valve, local processing, Hantu-Raya credit, GitHub source, Apache-2.0/NOTICE references.

## GitHub Pages
- Astro is configured with:
  - `site: "https://hantu-raya.github.io"`
  - `base: "/3d-hud-web-merger/"`
- Use `import.meta.env.BASE_URL` or helper functions when referencing public assets from React. Do not hardcode root-relative asset URLs that break under the Pages base path.
- The deploy workflow runs `npm ci` and `npm run check` before publishing `dist`.

## Environment Variables
Local helper and payload scripts support these overrides:

```text
HUD_INJECT_HELPER_PORT
HUD_INJECT_MAX_UPLOAD_BYTES
HUD_INJECT_MOD_ROOT
HUD_INJECT_3D_HUD_SOURCE
HUD_INJECT_SR2COMPILER
HUD_INJECT_VPKEDITCLI
HUD_INJECT_GAME_PAK01
HUD_INJECT_ALLOWED_ORIGINS
HUD_PAYLOAD_SOURCE_REPOSITORY
HUD_PAYLOAD_SOURCE_REF
HUD_PAYLOAD_SOURCE_DIR
PUBLIC_HUD_INJECT_HELPER_URL
```

Defaults assume the local Deadlock mods checkout at:

```text
F:\Users\FoxOS_User\Desktop\Deadlock-mods-collection
```

## Code Style
- Use ESM JavaScript.
- Keep imports grouped as external or Node built-ins first, then local modules.
- Prefer pure functions for VPK parsing, merging, and patch decisions.
- Use `Uint8Array` for binary data and clone byte arrays before mutating or replacing.
- Keep errors actionable and visible in the UI/helper JSON responses.
- Avoid broad refactors when fixing a concrete merge, patch, or UI issue.
- Do not edit generated `dist/` output manually.
- Do not commit local logs such as `.dev-server.*.log` or `.helper-server.*.log`.

## Test Coverage Checklist
When touching the relevant area, keep or add coverage for:

- VPK reader round-trips and malformed VPK rejection.
- Case-insensitive and slash-normalized conflict detection.
- Safe browser merge without conflicts.
- Browser patch rules for supported layout/style conflicts.
- Compiler-backed merge planning and finalization.
- Payload manifest presence, uniqueness, and required paths.
- Tutorial GIF/modal and UI text only through browser/manual smoke unless dedicated tests are added.

## Release Checklist
- `git status -sb` reviewed before and after edits.
- `npm run check` passes.
- `react-doctor` passes for UI/React changes.
- Helper syntax check passes for helper changes.
- Browser smoke completed for user-facing UI changes.
- Commit message is concise and behavior-focused.
- After push to `main`, GitHub Pages should deploy from `.github/workflows/deploy-pages.yml`.
