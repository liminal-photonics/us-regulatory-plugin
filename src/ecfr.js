// eCFR (Electronic Code of Federal Regulations) API, key-free. https://www.ecfr.gov/developers/documentation/api/v1
import { json, request, requireText, requireInt, clampLimit, stripTags } from "./http.js";
const BASE = process.env.ECFR_API_BASE || "https://www.ecfr.gov/api";

// Accept "15.109", "§ 15.109", "Sec. 15.109" and "47 CFR 15.109" (title must match). Exported for ibr_standards.
export function cleanSection(section, title) {
  let s = String(section).trim().replace(/^(?:§+|sec(?:tion)?\.?)\s*/i, "");
  const m = s.match(/^(\d+)\s*C\.?F\.?R\.?\s*(?:§+|sec(?:tion)?\.?|part)?\s*(.*)$/i);
  if (m) { if (title && m[1] !== String(title)) throw new Error(`section says title ${m[1]} but title is ${title}; use title ${m[1]}.`); s = m[2].trim(); }
  return s;
}
export const cleanPart = (part) => String(part).trim().replace(/^part\s+/i, "");

export function normalizeSearchResult(r) {
  const h = r.hierarchy || {};
  return {
    citation: h.section ? `${h.title} CFR ${h.section}` : h.part ? `${h.title} CFR Part ${h.part}` : `${h.title} CFR`,
    title: h.title, part: h.part, subpart: h.subpart, section: h.section,
    heading: stripTags(r.headings?.section || r.headings?.appendix || r.headings?.part || "").trim(),
    partHeading: stripTags(r.headings?.part || ""),
    excerpt: stripTags(r.full_text_excerpt).slice(0, 400),
    inEffectSince: r.starts_on || null,
    appendix: h.appendix || null,
    url: h.section ? `https://www.ecfr.gov/current/title-${h.title}/section-${h.section}` : h.part ? `https://www.ecfr.gov/current/title-${h.title}/part-${h.part}` : null,
  };
}

export async function ecfrSearch({ query, title, part, limit } = {}) {
  query = requireText(query, "query");
  const q = new URLSearchParams({ query, per_page: String(clampLimit(limit, 10, 50)), date: "current" });
  if (title != null && title !== "") q.set("hierarchy[title]", String(requireInt(title, "title", 1, 50)));
  if (part != null && part !== "") { part = cleanPart(part); if (!/^\d+[A-Za-z]?$/.test(String(part).trim())) throw new Error('part must be a part number like "15".'); q.set("hierarchy[part]", String(part).trim()); }
  const d = await json("eCFR", `${BASE}/search/v1/results?${q}`);
  return { query, total: d?.meta?.total_count ?? 0, results: (d?.results || []).map(normalizeSearchResult) };
}

export async function latestDate(title) {
  const d = await json("eCFR", `${BASE}/versioner/v1/titles.json`);
  const t = (d?.titles || []).find((x) => String(x.number) === String(title));
  if (!t) throw new Error(`eCFR: title ${title} not found.`);
  if (t.reserved) throw new Error(`eCFR: title ${title} is reserved.`);
  return t.up_to_date_as_of || t.latest_issue_date;
}

// Turn eCFR section XML into readable text. Tables become " | "-separated rows.
export function xmlToText(xml) {
  let s = String(xml).replace(/<\?xml[^>]*\?>/g, "");
  s = s.replace(/<TR[^>]*>/gi, "\n").replace(/<\/T[HD]>\s*<T[HD][^>]*>/gi, " | ");
  s = s.replace(/<(HEAD|P|FP|TR|CITA|DIV\d?|NOTE|EXTRACT)[^>]*>/gi, "\n").replace(/<\/(HEAD|P|FP|TABLE|CITA|NOTE)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}

const realDate = (d) => { const t = Date.parse(`${d}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d; };

export async function ecfrGetSection({ title, section, date } = {}) {
  title = String(requireInt(title, "title", 1, 50));
  if (date != null && date !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !realDate(String(date)))) throw new Error("date must be a real date as YYYY-MM-DD.");
  section = cleanSection(requireText(section, "section"), title);
  if (!/^\d+[A-Za-z]?\.\d+[A-Za-z0-9-]*$/.test(section)) throw new Error('section must look like "15.109" (part.section).');
  const part = section.split(".")[0];
  const latest = await latestDate(title);
  if (date && String(date) > latest) throw new Error(`eCFR title ${title} is only published up to ${latest}; use that date or earlier.`);
  const asOf = date ? String(date) : latest;
  const res = await request("eCFR", `${BASE}/versioner/v1/full/${asOf}/title-${title}.xml?part=${encodeURIComponent(part)}&section=${encodeURIComponent(section)}`, { headers: { "Accept-Encoding": "gzip" } });
  if (res.status === 404) return null;
  if (res.status === 400) throw new Error(`eCFR has no version of ${title} CFR ${section} for ${asOf} (the date may be before the section existed or after the latest update).`);
  if (!res.ok) throw new Error(`eCFR HTTP ${res.status}`);
  const xml = await res.text();
  const text = xmlToText(xml);
  const MAX = 20000;
  return {
    citation: `${title} CFR ${section}`,
    asOf,
    heading: text.split("\n")[0] || null,
    text: text.length > MAX ? text.slice(0, MAX) + "\n[truncated]" : text,
    url: `https://www.ecfr.gov/current/title-${title}/section-${section}`,
  };
}

export async function ecfrStatus() {
  const res = await request("eCFR", `${BASE}/versioner/v1/titles.json`);
  return res.ok ? "reachable (no key needed)" : `HTTP ${res.status}`;
}
