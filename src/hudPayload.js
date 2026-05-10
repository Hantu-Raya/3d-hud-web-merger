function joinUrl(baseUrl, path) {
  const base = String(baseUrl || "/");
  const cleanBase = base.endsWith("/") ? base : `${base}/`;
  return `${cleanBase}${String(path).replace(/^\/+/, "")}`;
}

function normalizeManifestPath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url} (${response.status})`);
  }
  return response.text();
}

export async function loadHudPayload(baseUrl = "/") {
  const manifestUrl = joinUrl(baseUrl, "payload/3d-hud/manifest.json");
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load 3D HUD payload manifest (${manifestResponse.status})`);
  }

  const manifest = await manifestResponse.json();
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("3D HUD payload manifest has no files");
  }

  const [files, hudProbeSource] = await Promise.all([
    Promise.all(manifest.files.map(async (rawPath) => {
      const path = normalizeManifestPath(rawPath);
      return {
        path,
        bytes: await fetchBytes(joinUrl(baseUrl, `payload/3d-hud/${path}`))
      };
    })),
    fetchText(joinUrl(baseUrl, "payload/3d-hud/hud-probe.xml"))
  ]);

  return {
    manifest,
    files,
    hudProbeSource,
    totalBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0)
  };
}
