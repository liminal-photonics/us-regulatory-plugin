// FCC equipment authorization grantee lookup via the FCC Open Data portal (Socrata), key-free.
// Dataset: "EAS Equipment Authorization Grantee Registrations" (3b3k-34jp), https://opendata.fcc.gov/d/3b3k-34jp
// The FCC has not refreshed this dataset since March 2021, and it lists grantees (companies), not individual FCC ID grants.
// The FCC's own EAS grant search (apps.fcc.gov/oetcf/eas) blocks automated access, so grants are not looked up here.
import { json, clampLimit } from "./http.js";
const BASE = process.env.FCC_OPENDATA_BASE || "https://opendata.fcc.gov";
const DATASET = "3b3k-34jp";
const EAS_SEARCH = "https://apps.fcc.gov/oetcf/eas/reports/GenericSearch.cfm";

// Grantee codes are 3 characters (assigned before 2013) or 5 characters starting with "2" (2013 on).
export function splitFccId(fccId) {
  const id = String(fccId || "").toUpperCase().replace(/[\s-]+/g, (m) => (m.includes("-") ? "-" : ""));
  const clean = id.replace(/[^A-Z0-9-]/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{3,}$/.test(clean)) throw new Error('fccId must look like "2AC7Z-ESPWROOM32" or "BCG-E3091A".');
  const flat = clean.replace(/-/g, "");
  const len = flat.startsWith("2") ? 5 : 3;
  return { granteeCode: flat.slice(0, len), productCode: flat.slice(len) || null };
}

export function normalizeGrantee(r) {
  // contact_name is left out on purpose (it names a person).
  return {
    granteeCode: r.grantee_code || null,
    granteeName: r.grantee_name || null,
    city: r.city || null,
    state: r.state && r.state !== "N/A" ? r.state : null,
    country: r.country || null,
    registered: r.date_received ? r.date_received.slice(0, 10) : null,
  };
}

let freshness = null;
async function datasetUpdated() {
  if (freshness) return freshness;
  try {
    const v = await json("FCC Open Data", `${BASE}/api/views/${DATASET}.json`);
    freshness = v?.rowsUpdatedAt ? new Date(v.rowsUpdatedAt * 1000).toISOString().slice(0, 10) : null;
  } catch { freshness = null; }
  return freshness;
}

const soqlString = (s) => String(s).replace(/'/g, "''");

export async function fccGranteeLookup({ fccId, granteeCode, name, limit } = {}) {
  let code = granteeCode ? String(granteeCode).toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
  let productCode = null;
  if (fccId) ({ granteeCode: code, productCode } = splitFccId(fccId));
  // % and _ are wildcards in SoQL LIKE; drop them so "%%%" cannot match every grantee
  const nm = typeof name === "string" ? name.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!code && !nm) throw new Error("Give fccId, granteeCode or name.");
  if (code && !/^([A-Z0-9]{3}|2[A-Z0-9]{4})$/.test(code)) throw new Error("granteeCode must be 3 characters, or 5 starting with 2.");
  if (nm && nm.length < 3) throw new Error("name must be at least 3 characters.");
  const q = new URLSearchParams({ $limit: String(clampLimit(limit, 10, 50)), $order: "grantee_name" });
  q.set("$where", code ? `grantee_code='${soqlString(code)}'` : `upper(grantee_name) like '%${soqlString(nm.toUpperCase())}%'`);
  const rows = await json("FCC Open Data", `${BASE}/resource/${DATASET}.json?${q}`);
  const updated = await datasetUpdated();
  return {
    query: code ? { granteeCode: code, productCode } : { name: nm },
    results: (rows || []).map(normalizeGrantee),
    datasetUpdated: updated,
    note: `Grantee registrations only, from the FCC Open Data portal${updated ? ` (last updated ${updated})` : ""}. Grantees registered after that date will not appear, and this does not show whether a specific FCC ID was granted. Confirm grants in the FCC Equipment Authorization System: ${EAS_SEARCH}`,
  };
}
