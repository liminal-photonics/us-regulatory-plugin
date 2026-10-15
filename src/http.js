// Shared fetch wrapper: 20 s timeout, clear 429 and HTTP errors. Never puts URLs or headers (which may carry keys) in errors.
export const TIMEOUT_MS = Number(process.env.US_REGULATORY_TIMEOUT_MS) || 20000;
const UA = "us-regulatory-plugin/0.1 (+https://github.com/liminal-photonics/us-regulatory-plugin)";

export async function request(name, url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error(`${name} timed out after ${TIMEOUT_MS / 1000} s`);
    throw new Error(`${name} network error: ${e.message}`);
  }
  if (res.status === 429) {
    const after = res.headers?.get?.("retry-after");
    throw new Error(`${name} rate limit reached${after ? `; retry after ${after} s` : ""}. Wait and try again.`);
  }
  return res;
}

export async function json(name, url, init) {
  const res = await request(name, url, init);
  if (res.status === 404) return null;
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).replace(/\s+/g, " ").slice(0, 200); } catch {}
    throw new Error(`${name} HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export function requireText(v, field) {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s) throw new Error(`${field} is required and must be non-empty.`);
  return s;
}

export function clampLimit(v, def = 10, max = 50) {
  return Math.min(max, Math.max(1, Math.floor(Number(v)) || def));
}

export function stripTags(s) {
  return String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
