// USPTO trademarks.
// - Mark search: the public, key-free JSON endpoint behind USPTO's Trademark Search (tmsearch.uspto.gov). It is not a
//   documented API and USPTO can change it without notice.
// - Case status: the TSDR API (tsdrapi.uspto.gov), which needs a free USPTO API key (USPTO_TSDR_API_KEY).
import { json, requireText, clampLimit } from "./http.js";
const SEARCH_URL = process.env.USPTO_TMSEARCH_URL || "https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch";
const TSDR_BASE = process.env.USPTO_TSDR_API_BASE || "https://tsdrapi.uspto.gov/ts/cd/casestatus";

export const tsdrKey = () => process.env.USPTO_TSDR_API_KEY || "";
export const tsdrConfigured = () => Boolean(tsdrKey());

const SOURCE = ["id", "wordmark", "alive", "statusCode", "statusDescription", "filedDate", "registrationDate", "registrationId", "internationalClass", "goodsAndServices", "ownerName", "markType", "drawingCodeDescription", "abandonDate", "cancelDate"];

export function normalizeClasses(classes) {
  const list = Array.isArray(classes) ? classes : classes != null && classes !== "" ? [classes] : [];
  return list.map((c) => {
    const n = parseInt(String(c).replace(/\D/g, ""), 10);
    if (!(n >= 1 && n <= 45)) throw new Error(`Class "${c}" is not a Nice class (1-45).`);
    return String(n).padStart(3, "0");
  });
}

export function buildSearchQuery(mark, { liveOnly = true, classes = [], limit = 20 } = {}) {
  const filter = [];
  if (liveOnly) filter.push({ term: { alive: true } });
  if (classes.length) filter.push({ terms: { IC: classes } });
  return {
    query: {
      bool: {
        should: [
          { match_phrase: { WM: { query: mark, boost: 5 } } },
          { match: { WM: { query: mark, fuzziness: "AUTO", boost: 2 } } },
          { match_phrase_prefix: { WM: mark } },
        ],
        minimum_should_match: 1,
        filter,
      },
    },
    size: limit,
    _source: SOURCE,
  };
}

export function normalizeMark(hit) {
  const s = hit.source || hit._source || {};
  return {
    serialNumber: s.id || hit.id || null,
    mark: s.wordmark || null,
    live: s.alive ?? null,
    status: s.statusDescription || null,
    statusCode: s.statusCode ?? null,
    filed: s.filedDate ? s.filedDate.slice(0, 10) : null,
    registrationNumber: s.registrationId || null,
    registered: s.registrationDate || null,
    classes: s.internationalClass || [],
    goodsAndServices: (s.goodsAndServices || []).join(" ").slice(0, 400) || null,
    owner: (s.ownerName || [])[0] || null,
    drawing: s.drawingCodeDescription || null,
    tsdrUrl: s.id ? `https://tsdr.uspto.gov/#caseNumber=${s.id}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch` : null,
  };
}

export async function trademarkSearch({ mark, liveOnly = true, classes, limit } = {}) {
  mark = requireText(mark, "mark");
  const cls = normalizeClasses(classes);
  const body = buildSearchQuery(mark, { liveOnly: liveOnly !== false, classes: cls, limit: clampLimit(limit, 20, 100) });
  const d = await json("USPTO trademark search", SEARCH_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const hits = d?.hits;
  if (!hits) throw new Error("USPTO trademark search returned an unexpected response (the public search endpoint may have changed).");
  return {
    mark, liveOnly: liveOnly !== false, classes: cls,
    total: hits.totalValue ?? null, totalIsLowerBound: hits.totalRelation === "gte",
    results: (hits.hits || []).map(normalizeMark),
    disclaimer: "Knockout search of USPTO records only. Not legal clearance: it misses common-law, state and foreign rights and is not a likelihood-of-confusion opinion.",
  };
}

function ownerOf(t) {
  const groups = t.parties?.ownerGroups || {};
  const all = Object.values(groups).flat();
  const seen = new Set();
  return all.map((o) => ({ name: o.name, role: o.partyTypeDescription, entity: o.entityType?.description || null })).filter((o) => { const k = `${o.name}|${o.role}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function normalizeTsdr(d) {
  const t = d?.trademarks?.[0];
  if (!t?.status) return null;
  const s = t.status;
  return {
    serialNumber: String(s.serialNumber),
    registrationNumber: s.usRegistrationNumber || null,
    mark: s.markElement || null,
    drawing: s.markDrawDesc || null,
    filed: s.filingDate || null,
    status: s.extStatusDesc ? s.extStatusDesc.replace(/\s+To view all documents.*$/i, "").trim() : null,
    statusSummary: s.tm5StatusDesc || null,
    statusCode: s.status ?? null,
    statusDate: s.statusDate || null,
    abandoned: s.dateAbandoned || null,
    examiner: s.staff?.examiner?.name || null,
    lawOffice: s.lawOffAssigned || null,
    owners: ownerOf(t),
    classes: (t.gsList || []).flatMap((g) => (g.internationalClasses || []).map((c) => `${c.code} ${c.description}`)),
    recentHistory: (t.prosecutionHistory || []).slice(0, 8).map((h) => ({ date: (h.entryDate || "").slice(0, 10), event: h.entryDesc })),
    tsdrUrl: `https://tsdr.uspto.gov/#caseNumber=${s.serialNumber}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`,
  };
}

export async function trademarkStatus({ serialNumber } = {}) {
  const sn = requireText(serialNumber, "serialNumber").replace(/\D/g, "");
  if (!/^\d{8}$/.test(sn)) throw new Error("serialNumber must be an 8-digit USPTO serial number.");
  if (!tsdrConfigured()) {
    return { serialNumber: sn, error: "TSDR status needs a free USPTO API key: set USPTO_TSDR_API_KEY (see README). trademark_search still works without a key.", tsdrUrl: `https://tsdr.uspto.gov/#caseNumber=${sn}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch` };
  }
  let d;
  try {
    d = await json("USPTO TSDR", `${TSDR_BASE}/sn${sn}/info.json`, { headers: { "USPTO-API-KEY": tsdrKey(), Accept: "application/json" } });
  } catch (e) {
    if (/HTTP 40[13]/.test(e.message)) throw new Error("USPTO TSDR rejected the API key (HTTP 401/403). Check USPTO_TSDR_API_KEY.");
    throw e;
  }
  const n = normalizeTsdr(d);
  return n || { serialNumber: sn, error: "No TSDR record for that serial number." };
}
