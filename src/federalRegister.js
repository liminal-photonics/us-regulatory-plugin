// Federal Register API, key-free. https://www.federalregister.gov/developers/documentation/api/v1
import { json, clampLimit } from "./http.js";
const BASE = process.env.FEDERAL_REGISTER_API_BASE || "https://www.federalregister.gov/api/v1";
const FIELDS = ["title", "type", "action", "abstract", "document_number", "publication_date", "effective_on", "comments_close_on", "agencies", "cfr_references", "docket_ids", "html_url", "pdf_url"];
export const DOC_TYPES = { rule: "RULE", proposed_rule: "PRORULE", notice: "NOTICE", presidential_document: "PRESDOCU" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeDocument(d) {
  return {
    title: d.title || null,
    type: d.type || null,
    action: d.action || null,
    documentNumber: d.document_number || null,
    published: d.publication_date || null,
    effective: d.effective_on || null,
    commentsClose: d.comments_close_on || null,
    agencies: (d.agencies || []).map((a) => a.name || a.raw_name).filter(Boolean),
    cfrReferences: (d.cfr_references || []).map((c) => `${c.title} CFR ${c.part ?? ""}`.trim()),
    dockets: d.docket_ids || [],
    abstract: d.abstract ? d.abstract.slice(0, 600) : null,
    url: d.html_url || null,
    pdf: d.pdf_url || null,
  };
}

export async function federalRegisterSearch({ term, agencies, types, cfrTitle, cfrPart, from, to, limit } = {}) {
  const t = typeof term === "string" ? term.trim() : "";
  const ag = Array.isArray(agencies) ? agencies.filter(Boolean) : agencies ? [agencies] : [];
  if (!t && !ag.length && !cfrTitle) throw new Error("Give at least one of term, agencies or cfrTitle.");
  for (const d of [from, to]) if (d && !DATE.test(d)) throw new Error("Dates must be YYYY-MM-DD.");
  if (cfrPart && !cfrTitle) throw new Error("cfrPart needs cfrTitle.");
  const q = new URLSearchParams({ per_page: String(clampLimit(limit, 10, 100)), order: "newest" });
  for (const f of FIELDS) q.append("fields[]", f);
  if (t) q.set("conditions[term]", t);
  for (const a of ag) q.append("conditions[agencies][]", String(a).trim().toLowerCase().replace(/\s+/g, "-"));
  const ty = Array.isArray(types) ? types : types ? [types] : [];
  for (const x of ty) {
    const code = DOC_TYPES[String(x).toLowerCase()] || String(x).toUpperCase();
    if (!Object.values(DOC_TYPES).includes(code)) throw new Error(`Unknown document type "${x}". Use rule, proposed_rule, notice or presidential_document.`);
    q.append("conditions[type][]", code);
  }
  if (cfrTitle) q.set("conditions[cfr][title]", String(cfrTitle));
  if (cfrPart) q.set("conditions[cfr][part]", String(cfrPart));
  if (from) q.set("conditions[publication_date][gte]", from);
  if (to) q.set("conditions[publication_date][lte]", to);
  let d;
  try {
    d = await json("Federal Register", `${BASE}/documents.json?${q}`);
  } catch (e) {
    if (/HTTP 400/.test(e.message) && /agencies/.test(e.message)) throw new Error('Federal Register: unknown agency slug. Use slugs like "federal-communications-commission" or "patent-and-trademark-office".');
    throw e;
  }
  return { description: d?.description || null, total: d?.count ?? 0, results: (d?.results || []).map(normalizeDocument) };
}
