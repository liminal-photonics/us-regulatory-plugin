// Shared fetch wrapper: 20 s timeout, clear 429 and HTTP errors. Never puts URLs or headers (which may carry keys) in errors.
export const TIMEOUT_MS = Number(process.env.US_REGULATORY_TIMEOUT_MS) || 20000;
const UA = "us-regulatory-plugin/0.1 (+https://github.com/liminal-photonics/us-regulatory-plugin)";

// One automatic retry on HTTP 429 after Retry-After (capped at 5 s, default 2 s), then a clear error.
export async function request(name, url, init = {}, attempt = 0) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error(`${name} timed out after ${TIMEOUT_MS / 1000} s`);
    throw new Error(`${name} network error: ${e.message}`);
  }
  if (res.status === 429) {
    const after = res.headers?.get?.("retry-after");
    if (attempt === 0 && !process.env.NO_RETRY_429) {
      const wait = Math.min(5, Number(after) || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return request(name, url, init, 1);
    }
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
  try {
    return await res.json();
  } catch {
    throw new Error(`${name} returned a response that is not JSON (the service may be down or changed).`);
  }
}

export function requireInt(v, field, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${field} must be a whole number from ${min} to ${max}.`);
  return n;
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
