# Third-party notices

This repository contains original code by **Hantu-Raya** and bundled files used by the 3D HUD injector.

## Bundled payload

- **Compiled 3D HUD payload files** in `public/payload/3d-hud/` are included so the browser tool can merge them into an uploaded Deadlock addon VPK.
- **Deadlock and Source 2 names, paths, and file formats** belong to their respective owners. This is an unofficial fan-made tool and is not affiliated with Valve.

## Runtime and libraries

- **Astro, React, Playwright, and npm dependencies** - see each package's license in `package-lock.json` and upstream repositories.
- **Local Source 2 compiler helper** expects user-provided Deadlock mod source and compiler paths at runtime. The helper does not upload VPKs to a server.

## Generated artifacts

The repository should not commit Astro build output. Regenerate it with `npm run build` when needed.
