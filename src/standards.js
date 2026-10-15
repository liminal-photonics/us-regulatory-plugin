// Standards: (1) list material incorporated by reference (IBR) in a CFR part from its eCFR IBR section;
// (2) build official purchase/info links for standards bodies. Never returns standard text (copyrighted).
import { json, request, requireText, requireInt } from "./http.js";
import { latestDate } from "./ecfr.js";
const ECFR = process.env.ECFR_API_BASE || "https://www.ecfr.gov/api";
export const COPYRIGHT = "Standards are copyrighted by their publishers. This tool lists citations and links only; it does not show standard text. IBR material can also be viewed at the agency or NARA (see the IBR section).";

const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const clean = (s) => decode(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Map a publisher name to a standards_link body key (best effort).
export function bodyKeyFor(name) {
  const n = String(name || "").toUpperCase();
  const table = [
    [/INTERNATIONAL ELECTROTECHNICAL|\bIEC\b|CISPR/, "iec"], [/INTERNATIONAL ORGANIZATION FOR STANDARDIZATION|\bISO\b/, "iso"],
    [/UNDERWRITERS|\bUL\b|ULSE/, "ul"], [/ASTM/, "astm"], [/INSTITUTE OF ELECTRICAL AND ELECTRONICS|\bIEEE\b/, "ieee"],
    [/NATIONAL FIRE PROTECTION|\bNFPA\b/, "nfpa"], [/COMMISSION INTERNATIONALE DE L|\bCIE\b/, "cie"], [/ILLUMINATING ENGINEERING|\bIES\b|\bIESNA\b/, "ies"],
    [/NATIONAL ELECTRICAL MANUFACTURERS|\bNEMA\b/, "nema"], [/AMERICAN NATIONAL STANDARDS INSTITUTE|\bANSI\b/, "ansi"],
  ];
  for (const [re, k] of table) if (re.test(n)) return k;
  return null;
}

// Split "ANSI C63.17-2013" / "IEC 61000-4-2:2008" / "ASTM E308-22" into number and edition.
export function splitDesignation(id) {
  const s = String(id).trim();
  let m = s.match(/^(.*?):((?:19|20)\d{2})\b.*$/); // IEC 61000-4-2:2008
  if (m) return { number: m[1].trim(), edition: m[2] };
  m = s.match(/^(.+?)-((?:19|20)\d{2})$/); // ANSI C63.4-2014, IEEE 1789-2015
  if (m) return { number: m[1].trim(), edition: m[2] };
  m = s.match(/^((?:[A-Z]+\s)?[A-Z]+[\s-]?\d+[A-Za-z]?)-(\d{2})[a-z]?$/i); // ASTM E308-22, LM-79-19
  if (m) return { number: m[1].trim(), edition: m[2] };
  return { number: s, edition: null };
}

// Most titles say "IBR approved for § ..."; 49 CFR 171.7 says ", into §§ ...".
const MARK = /IBR approved for|,?\s+into\s+§/i;
const MARK_SRC = "(?:;\\s*IBR approved|,?\\s+into\\s+§)";

// Parse an eCFR IBR section (XML) into publishers and their standards.
export function parseIbr(xml) {
  const paras = [...String(xml).matchAll(/<P>([\s\S]*?)<\/P>/g)].map((m) => m[1]);
  const publishers = [];
  let cur = null;
  for (const raw of paras) {
    const text = clean(raw);
    const letter = text.match(/^\(([a-z])\)\s+(.*)$/);
    let num = text.match(/^\((\d+)\)\s+(.*)$/);
    // "(i)", "(ii)" sub-items that list a standard (40 CFR 60.17) belong to the current publisher.
    const roman = text.match(/^\(([ivx]+)\)\s+(.*)$/);
    const romanItem = Boolean(roman && cur && cur.standards.length && MARK.test(text));
    if (romanItem) num = roman;
    if (letter && !romanItem) {
      const rest = letter[2];
      if (/resellers?/i.test(rest) && !MARK.test(rest)) { cur = null; continue; } // reseller list, not a publisher
      const name = (rest.match(/^(.*?)(?:,\s*(?:\d|P\.\s?O\.|c\/o|Attn)|;\s*phone|;\s*website|,\s*phone)/i) || [null, rest.slice(0, 120)])[1].trim();
      const site = (raw.match(/website:\s*<I>\s*([^<]+?)\s*<\/I>/i) || [])[1];
      cur = { letter: letter[1], publisher: name, bodyKey: bodyKeyFor(name), website: site ? site.replace(/[.;,]+$/, "") : null, standards: [] };
      publishers.push(cur);
    } else if (num && cur && MARK.test(text)) {
      let titleM = raw.match(/<I>([\s\S]*?)<\/I>/);
      if (titleM && /^\s*(https?:|www\.)/i.test(titleM[1])) titleM = null; // italic URL, not a title
      let before, after, plainTitle = null;
      if (titleM) {
        before = clean(raw.slice(0, titleM.index)).replace(/^\((?:\d+|[ivx]+)\)\s*/, "");
        after = clean(raw.slice(titleM.index + titleM[0].length));
      } else {
        // No italic title: "SCTE 28 2003 (formerly DVS 295): “Host-POD Interface Standard,” 2003; IBR ..." or "ETSI EN 300 422-1 V2.2.1 (2021-11), Title; Part 1, published ...; IBR ..."
        const body = num[2];
        const q = body.match(/^(.*?)[:,]\s*[“"](.+?)[,]?[”"],?\s*(.*)$/);
        if (q) { before = q[1]; plainTitle = q[2]; after = q[3]; }
        else {
          const c = body.match(new RegExp(`^(.*?(?:\\([^)]*\\))?),\\s*(.*?)(?:,\\s*((?:published|approved|dated)?[^,;]*?(?:19|20)\\d{2}[^;]*?))${MARK_SRC}`, "i"));
          if (c) { before = c[1]; plainTitle = c[2]; after = `${c[3] || ""}; IBR approved`; }
          else { before = body.split(/[,;]/)[0]; after = body.slice(before.length); }
        }
      }
      before = before.replace(/[,:]\s*$/, "").trim();
      const dateText = ((after.match(new RegExp(`^,?\\s*(.*?)${MARK_SRC}`, "i")) || [])[1] || "").trim() || null;
      const approved = ((text.match(/(?:IBR approved for|\binto)\s+(§[^.]*(?:\.\d+[^.]*)*|[^.]*(?:\.\d+[^.]*)*)/i) || [])[1] || "").replace(/\s*\(Available at.*$/i, "").trim();
      const sections = [...approved.matchAll(/(\d+[A-Za-z]?\.\d+[A-Za-z0-9-]*)(\([a-z0-9]+\))*/g)].map((m) => m[0]);
      const { number, edition } = splitDesignation(before);
      cur.standards.push({
        designation: before,
        number,
        edition: edition || (dateText && (dateText.match(/\b(19|20)\d{2}\b/) || [])[0]) || null,
        title: titleM ? clean(titleM[1]).replace(/,\s*$/, "") : plainTitle ? plainTitle.replace(/,\s*$/, "") : null,
        dated: dateText,
        approvedFor: sections,
        approvedForText: approved || null,
        bodyKey: bodyKeyFor(before) || cur.bodyKey,
      });
    }
  }
  return publishers.filter((p) => p.standards.length);
}

// IBR section headings vary: "Incorporation by reference" (47 CFR 15.38), "Incorporations by reference" (40 CFR 60.17),
// "Materials incorporated by reference" (10 CFR 430.3), "Reference material" (49 CFR 171.7).
const IBR_HEADING = /incorporat\w* by reference|reference materials?\b/i;
async function findIbrSection(title, part) {
  for (const query of ["incorporation by reference", "incorporated by reference", "reference material"]) {
    const q = new URLSearchParams({ query, per_page: "20", date: "current", "hierarchy[title]": String(title), "hierarchy[part]": String(part) });
    const d = await json("eCFR", `${ECFR}/search/v1/results?${q}`);
    const hit = (d?.results || []).find((r) => r.hierarchy?.section && String(r.hierarchy.part) === String(part) && IBR_HEADING.test(clean(r.headings?.section || "")));
    if (hit) return hit.hierarchy.section;
  }
  return null;
}

async function sectionXml(title, part, section, asOf) {
  const res = await request("eCFR", `${ECFR}/versioner/v1/full/${asOf}/title-${title}.xml?part=${encodeURIComponent(part)}&section=${encodeURIComponent(section)}`, { headers: { "Accept-Encoding": "gzip" } });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`eCFR HTTP ${res.status}`);
  return res.text();
}

export async function ibrStandards({ title, part, section } = {}) {
  title = String(requireInt(title, "title", 1, 50));
  let sec = section != null && section !== "" ? String(section).replace(/^§\s*/, "").trim() : null;
  if (sec && !/^\d+[A-Za-z]?\.\d+[A-Za-z0-9-]*$/.test(sec)) throw new Error('section must look like "15.38" or "15.31".');
  part = part != null && part !== "" ? String(part).trim() : sec ? sec.split(".")[0] : null;
  if (!part) throw new Error("Give part (e.g. 15) or section (e.g. 15.38).");
  const asOf = await latestDate(title);
  // A section that itself lists IBR material is the IBR section (works even when its heading is unusual).
  let ibrSection = null, xml = null;
  if (sec) { const x = await sectionXml(title, part, sec, asOf); if (x && (IBR_HEADING.test(clean((x.match(/<HEAD>([\s\S]*?)<\/HEAD>/) || [])[1] || "")) || parseIbr(x).reduce((n, p) => n + p.standards.length, 0) >= 3)) { ibrSection = sec; xml = x; } }
  if (!ibrSection) ibrSection = await findIbrSection(title, part);
  if (!ibrSection) return { citation: `${title} CFR Part ${part}`, ibrSection: null, publishers: [], note: `No "Incorporation by reference" section found for ${title} CFR Part ${part}. The part may cite standards inside individual sections, or have none.`, copyright: COPYRIGHT };
  if (!xml) xml = await sectionXml(title, part, ibrSection, asOf);
  if (!xml) throw new Error(`eCFR returned no text for ${title} CFR ${ibrSection}.`);
  let publishers = parseIbr(xml);
  const filtered = sec && sec !== ibrSection;
  if (filtered) publishers = publishers.map((p) => ({ ...p, standards: p.standards.filter((s) => s.approvedFor.some((a) => a === sec || a.startsWith(`${sec}(`))) })).filter((p) => p.standards.length);
  const count = publishers.reduce((n, p) => n + p.standards.length, 0);
  return {
    citation: `${title} CFR ${filtered ? sec : `Part ${part}`}`,
    ibrSection: `${title} CFR ${ibrSection}`, asOf, count, publishers,
    url: `https://www.ecfr.gov/current/title-${title}/section-${ibrSection}`,
    note: filtered && !count ? `No IBR material in ${title} CFR ${ibrSection} is approved for § ${sec}.` : undefined,
    copyright: COPYRIGHT,
  };
}

// ---------- standards_link ----------
const enc = encodeURIComponent;
const ansiSearch = (q) => `https://webstore.ansi.org/search/find?in=1&st=${enc(q)}`;
export const BODIES = {
  iec: { name: "IEC", prefix: "IEC", search: (q) => `https://webstore.iec.ch/en/products/?q=${enc(q)}` },
  iso: { name: "ISO", prefix: "ISO", search: (q) => `https://www.iso.org/search.html?q=${enc(q)}` },
  ul: { name: "UL Standards & Engagement", prefix: "UL", search: (q) => `https://www.ulse.org/search?keys=${enc(q)}`,
    deep: (n) => ({ url: `https://www.shopulstandards.com/ProductDetail.aspx?productId=UL${enc(n.replace(/^UL\s*/i, "").replace(/\s+/g, ""))}`, expect: new RegExp(`UL ${n.replace(/^UL\s*/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }) },
  ansi: { name: "ANSI Webstore", prefix: "", search: ansiSearch },
  astm: { name: "ASTM International", prefix: "ASTM", search: (q) => ansiSearch(q),
    deep: (n) => { const code = n.replace(/^ASTM\s*/i, "").replace(/-\d{2,4}[a-z]?$/i, "").replace(/\s+/g, "").toLowerCase(); return /^[a-g]\d+[a-z0-9.-]*$/.test(code) ? { url: `https://www.astm.org/standards/${enc(code)}`, expect: new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : null; } },
  ieee: { name: "IEEE Standards Association", prefix: "IEEE", search: (q) => `https://standards.ieee.org/search/?q=${enc(q)}`,
    deep: (n, ed) => { const num = n.replace(/^IEEE\s*(Std\.?)?\s*/i, "").trim(); return /^\d+[A-Za-z]?$/.test(num) ? { url: `https://standards.ieee.org/standard/${num}${ed && /^\d{4}$/.test(ed) ? `-${ed}` : ""}.html`, expect: new RegExp(num) } : null; } },
  nfpa: { name: "NFPA", prefix: "NFPA", search: (q) => `https://www.nfpa.org/search?q=${enc(q)}`,
    deep: (n) => { const num = n.replace(/^NFPA\s*/i, "").trim(); return /^\d+[A-Z]?$/i.test(num) ? { url: `https://www.nfpa.org/codes-and-standards/nfpa-${num.toLowerCase()}-standard-development/${num.toLowerCase()}`, expect: new RegExp(`NFPA ${num}`, "i") } : null; } },
  cie: { name: "CIE", prefix: "CIE", search: (q) => `https://cie.co.at/search/node?keys=${enc(q)}` },
  ies: { name: "Illuminating Engineering Society", prefix: "", search: (q) => `https://store.ies.org/?s=${enc(q)}` },
  nema: { name: "NEMA", prefix: "NEMA", search: (q) => `https://www.nema.org/search?q=${enc(q)}` },
};
const ALIASES = { ulse: "ul", "ul standards": "ul", "ieee sa": "ieee", iesna: "ies", "ansi webstore": "ansi", cispr: "iec" };

export function normalizeBody(body) {
  const b = String(body || "").trim().toLowerCase();
  return BODIES[b] ? b : ALIASES[b] || bodyKeyFor(body);
}

// "ok" = page matches; "missing" = 404 or a not-found / catalog fallback page; "unknown" = site blocked the check (403, timeout).
export async function checkPage(url, expect) {
  try {
    const res = await request("Standards link check", url, { headers: { Accept: "text/html" }, redirect: "follow" });
    if (res.status === 404 || res.status === 410) return "missing";
    if (!res.ok) return "unknown";
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    if (/not found|\b404\b/i.test(title)) return "missing";
    return !expect || expect.test(title) ? "ok" : "missing";
  } catch { return "unknown"; }
}

export async function standardsLink({ body, number, edition, check = true } = {}) {
  const key = normalizeBody(requireText(body, "body"));
  number = requireText(number, "number");
  if (!key || !BODIES[key]) throw new Error(`Unknown standards body "${body}". Use one of: ${Object.keys(BODIES).join(", ")}.`);
  const b = BODIES[key];
  const sp = splitDesignation(number);
  const ed = edition ? String(edition).trim() : sp.edition;
  const bare = sp.number.replace(new RegExp(`^${b.prefix}\\s*`, "i"), "").trim();
  const query = b.prefix ? `${b.prefix} ${bare}` : bare;
  const links = [];
  const d = b.deep ? b.deep(bare, ed) : null;
  if (d) {
    const st = check === false ? "unchecked" : await checkPage(d.url, d.expect);
    if (st !== "missing") links.push({ kind: "product page", url: d.url, verified: st === "ok", ...(st === "unknown" ? { verifyNote: "Site blocked the automated check; open it to confirm." } : {}) });
  }
  const withEd = ed ? `${query}${key === "iec" || key === "iso" ? ":" : "-"}${ed}` : query;
  if (key === "ansi" || key === "astm") links.push({ kind: "ANSI Webstore search", url: ansiSearch(withEd) });
  else {
    links.push({ kind: "catalog search", url: b.search(query) });
    links.push({ kind: "ANSI Webstore search", url: ansiSearch(withEd) });
  }
  return {
    body: b.name, number: bare, edition: ed || null, links,
    note: d && !links.some((l) => l.kind === "product page") ? "No product page matched that number; use the search links." : undefined,
    copyright: COPYRIGHT,
  };
}
