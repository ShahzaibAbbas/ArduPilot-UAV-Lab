const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizedHostname(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isAllowedLocalOrigin(origin) {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && localHostnames.has(normalizedHostname(parsed.hostname));
  } catch {
    return false;
  }
}
