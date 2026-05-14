export const DEFAULT_COMPILER_HELPER_URL = "http://127.0.0.1:4329";

export function normalizeCompilerHelperUrl(value = DEFAULT_COMPILER_HELPER_URL) {
  const helperUrl = String(value || DEFAULT_COMPILER_HELPER_URL).trim() || DEFAULT_COMPILER_HELPER_URL;
  return helperUrl.replace(/\/+$/, "");
}

export function compilerHelperEndpoint(helperUrl, path) {
  return `${normalizeCompilerHelperUrl(helperUrl)}/${String(path || "").replace(/^\/+/, "")}`;
}

export function buildCompilerHelperFetchOptions(options = {}) {
  return {
    ...options,
    targetAddressSpace: "loopback"
  };
}

export function isLocalHelperAccessBlockedError(error) {
  return error instanceof TypeError || /failed to fetch|network/i.test(error?.message || "");
}
