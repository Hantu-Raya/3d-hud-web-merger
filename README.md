# 3D HUD VPK Merger

Merge the compiled 3D HUD payload into a locally selected Deadlock addon VPK. Files stay on your machine.

The tool reads the selected VPK locally in the browser. Simple non-conflicting merges and all HUD UI scale values happen fully client-side with bundled compiled scale variants. Unsupported compiled layout conflicts are blocked instead of uploading files anywhere.

## Demo

![3D HUD VPK Merger usage demo](public/demo/usage-demo.gif)

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4328/3d-hud-web-merger/` or the port Astro prints.

The local compiler helper is still available for developer testing of compiled layout conflict patches:

```bash
npm run helper
```

The helper listens only on `127.0.0.1`. It is not required for HUD UI scale.

## Payload Refresh

The bundled payload is generated from the latest custom `main/3d hud` source in:

```text
https://github.com/Hantu-Raya/Deadlock-mods-collection/tree/main/3d%20hud
```

Refresh it locally with the Source 2 compiler wrapper available:

```bash
npm run payload:sync
```

The refresh command downloads the latest raw HUD source, minifies `panorama/scripts/3d_hero_dynamic.js` with Terser, downloads the current base Panorama CSS from SteamTracking/GameTracking-Deadlock, compiles everything into `_c` payload files, compiles HUD UI scale variants from `120%` through `169%`, and records both upstream commits in `public/payload/3d-hud/manifest.json`.

Base CSS comes from:

```text
https://github.com/SteamTracking/GameTracking-Deadlock/tree/master/game/citadel/pak01_dir/panorama/styles
```

## GitHub Pages

This repo is configured for project Pages at:

```text
https://hantu-raya.github.io/3d-hud-web-merger/
```

In the GitHub repository settings, set Pages to **GitHub Actions**. The included workflow builds and deploys `dist` on pushes to `main`.

## Verification

```bash
npx -y react-doctor@latest . --json --offline
npm run check
node --check scripts/local-compiler-helper.mjs
```

To regenerate the README demo GIF while the local dev server is running:

```bash
npm run demo:gif
```

## Notes

- VPK files are processed locally; the web app does not upload them to a server.
- HUD UI scale uses precompiled payload variants on GitHub Pages; no local helper is needed for the slider.
- This is an unofficial fan-made tool and is not affiliated with Valve.

## License

This project is licensed under the Apache License, Version 2.0. See `LICENSE`.

Attribution notices for this project are included in `NOTICE`. If you distribute this software or derivative works, preserve the applicable copyright, license, and notice files as required by Apache-2.0.
