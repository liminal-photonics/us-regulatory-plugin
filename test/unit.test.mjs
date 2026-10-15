import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchResult, xmlToText, ecfrSearch, ecfrGetSection } from "../src/ecfr.js";
import { normalizeDocument, federalRegisterSearch } from "../src/federalRegister.js";
import { splitFccId, normalizeGrantee, fccGranteeLookup } from "../src/fcc.js";
import { request } from "../src/http.js";
import { parseIbr, splitDesignation, standardsLink, normalizeBody, ibrStandards } from "../src/standards.js";

function mockFetch(fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fn;
  return () => { globalThis.fetch = real; };
}
const ok = (body, status = 200) => ({ ok: status < 400, status, headers: new Map(), json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

// Fixtures trimmed from live responses (Oct 2026).
const ECFR_HIT = { starts_on: "2016-12-15", ends_on: null, type: "Section", hierarchy: { title: "47", part: "15", subpart: "B", section: "15.109" }, headings: { part: "Radio Frequency Devices", section: "<strong>Radiated</strong> emission limits." }, full_text_excerpt: "the field strength of <strong>radiated</strong> emissions" };
const ECFR_XML = `<?xml version="1.0" encoding="UTF-8"?> <DIV8 N="15.109" TYPE="SECTION"><HEAD>§ 15.109 Radiated emission limits.</HEAD><P>(a) Except for Class A digital devices &amp; others:</P><TABLE><THEAD><TR><TH>Frequency of emission (MHz)</TH><TH>Field strength (microvolts/meter)</TH></TR></THEAD><TBODY><TR><TD>30-88</TD><TD>100</TD></TR></TBODY></TABLE></DIV8>`;
const FR_DOC = { title: "Protecting Against National Security Threats", type: "Proposed Rule", action: "Proposed rule.", document_number: "2026-16197", publication_date: "2026-08-07", effective_on: null, comments_close_on: "2026-09-08", agencies: [{ raw_name: "FEDERAL COMMUNICATIONS COMMISSION", name: "Federal Communications Commission", slug: "federal-communications-commission" }], cfr_references: [{ title: 47, part: "2" }, { title: 47, part: "15" }], docket_ids: ["ET Docket No. 21-232"], html_url: "https://www.federalregister.gov/d/2026-16197" };
test("eCFR search result and section XML normalize", () => {
  const r = normalizeSearchResult(ECFR_HIT);
  assert.equal(r.citation, "47 CFR 15.109");
  assert.equal(r.heading, "Radiated emission limits.");
  assert.equal(r.url, "https://www.ecfr.gov/current/title-47/section-15.109");
  const t = xmlToText(ECFR_XML);
  assert.match(t, /^§ 15.109 Radiated emission limits\.$/m);
  assert.match(t, /Class A digital devices & others/);
  assert.match(t, /^30-88 \| 100$/m);
});

test("eCFR get_section uses the latest date, sends compression, returns null on 404, validates input", async () => {
  const seen = [];
  const restore = mockFetch(async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("titles.json")) return ok({ titles: [{ number: 47, up_to_date_as_of: "2026-10-13" }] });
    if (String(url).includes("15.9999")) return ok({ error: "No matching content found." }, 404);
    return ok(ECFR_XML);
  });
  try {
    const s = await ecfrGetSection({ title: 47, section: "§ 15.109" });
    assert.equal(s.asOf, "2026-10-13");
    assert.equal(s.citation, "47 CFR 15.109");
    assert.match(seen[1].url, /full\/2026-10-13\/title-47\.xml\?part=15&section=15\.109/);
    assert.equal(seen[1].init.headers["Accept-Encoding"], "gzip");
    assert.equal(await ecfrGetSection({ title: 47, section: "15.9999" }), null);
    await assert.rejects(ecfrGetSection({ title: 47, section: "radiated" }), /part\.section/);
    await assert.rejects(ecfrSearch({ query: "  " }), /query is required/);
  } finally { restore(); }
});

test("Federal Register document normalizes and query is built correctly", async () => {
  const d = normalizeDocument(FR_DOC);
  assert.equal(d.commentsClose, "2026-09-08");
  assert.deepEqual(d.cfrReferences, ["47 CFR 2", "47 CFR 15"]);
  assert.deepEqual(d.agencies, ["Federal Communications Commission"]);
  let url;
  const restore = mockFetch(async (u) => { url = decodeURIComponent(String(u)); return ok({ count: 1, results: [FR_DOC] }); });
  try {
    const r = await federalRegisterSearch({ agencies: ["Federal Communications Commission"], types: ["proposed_rule"], cfrTitle: 47, cfrPart: "15", from: "2026-01-01" });
    assert.equal(r.total, 1);
    assert.match(url, /conditions\[agencies\]\[\]=federal-communications-commission/);
    assert.match(url, /conditions\[type\]\[\]=PRORULE/);
    assert.match(url, /conditions\[cfr\]\[part\]=15/);
  } finally { restore(); }
  await assert.rejects(federalRegisterSearch({}), /at least one/);
  await assert.rejects(federalRegisterSearch({ term: "x", from: "10/01/2026" }), /YYYY-MM-DD/);
  await assert.rejects(federalRegisterSearch({ term: "x", types: ["memo"] }), /Unknown document type/);
});

test("FCC ID splits into grantee and product codes", () => {
  assert.deepEqual(splitFccId("2AC7Z-ESPWROOM32"), { granteeCode: "2AC7Z", productCode: "ESPWROOM32" });
  assert.deepEqual(splitFccId("bcg-e3091a"), { granteeCode: "BCG", productCode: "E3091A" });
  assert.throws(() => splitFccId("x"), /fccId must look like/);
});

test("FCC grantee normalizes without contact names and the query is safe", async () => {
  // Trimmed from a live opendata.fcc.gov row (dataset 3b3k-34jp).
  const row = { grantee_code: "2AC7Z", grantee_name: "ESPRESSIF SYSTEMS (SHANGHAI) CO., LTD", city: "Shanghai", state: "N/A", country: "China", contact_name: "Some Person", date_received: "2014-09-15T00:00:00.000" };
  const g = normalizeGrantee(row);
  assert.equal(g.granteeCode, "2AC7Z");
  assert.equal(g.state, null);
  assert.equal(g.registered, "2014-09-15");
  assert.ok(!JSON.stringify(g).includes("Some Person"));
  const urls = [];
  const restore = mockFetch(async (u) => { urls.push(decodeURIComponent(String(u).replace(/\+/g, " "))); return String(u).includes("/api/views/") ? ok({ rowsUpdatedAt: 1616396691 }) : ok([row]); });
  try {
    const r = await fccGranteeLookup({ fccId: "2AC7Z-ESPWROOM32" });
    assert.equal(r.results[0].granteeName, "ESPRESSIF SYSTEMS (SHANGHAI) CO., LTD");
    assert.equal(r.datasetUpdated, "2021-03-22");
    assert.match(r.note, /does not show whether a specific FCC ID was granted/);
    assert.match(urls[0], /grantee_code='2AC7Z'/);
    await fccGranteeLookup({ name: "O'Brien" });
    assert.ok(urls.some((u) => u.includes("like '%O''BRIEN%'")));
  } finally { restore(); }
  await assert.rejects(fccGranteeLookup({}), /Give fccId/);
  await assert.rejects(fccGranteeLookup({ granteeCode: "ABCD" }), /3 characters/);
});

test("429 and timeouts give clear messages", async () => {
  let restore = mockFetch(async () => ({ ok: false, status: 429, headers: new Map([["retry-after", "30"]]) }));
  try { await assert.rejects(request("eCFR", "https://x"), /rate limit reached; retry after 30 s/); } finally { restore(); }
  restore = mockFetch(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
  try { await assert.rejects(request("eCFR", "https://x"), /timed out after 20 s/); } finally { restore(); }
});

// Trimmed from live eCFR XML for 47 CFR 15.38 (Oct 2026).
const IBR_XML = `<DIV8 N="15.38" TYPE="SECTION"><HEAD>§ 15.38 Incorporation by reference.</HEAD>
<P>(a) The IBR material may be obtained from the sources in the following paragraphs of this section or from one or more private resellers listed in this paragraph (a).</P>
<P>(1) Accuris Standards Store, 321 Inverness Drive, South Englewood, CO 80112; phone: (800) 332-6077; website: <I>https://accuristech.com.</I></P>
<P>(b) American National Standards Institute (ANSI), 25 West 43rd Street, 4th Floor, New York, NY 10036; phone: (212) 642-4980; email <I>info@ansi.org;</I> website: <I>https://webstore.ansi.org/.</I></P>
<P>(1) ANSI C63.17-2013, <I>American National Standard for Methods of Measurement of the Electromagnetic and Operational Compatibility of Unlicensed Personal Communications Services (UPCS) Devices,</I> approved August 12, 2013; IBR approved for § 15.31.</P>
<P>(c) Cable Television Laboratories, Inc., 858 Coal Creek Circle, Louisville, Colorado 80027; phone: (303) 661-9100; website: <I>www.cablelabs.com/.</I></P>
<P>(1) M-UDCP-PICS-I04-080225, <I>Uni-Directional Cable Product Supporting M-Card: Multiple Profiles; Conformance Checklist: PICS,</I> February 25, 2008; IBR approved for § 15.123(c).</P>
<P>(d) Institute of Electrical and Electronic Engineers (IEEE), 3 Park Avenue, New York, NY; website: <I>www.ieee.org/.</I></P>
<P>(1) ANSI C63.10-2013, <I>American National Standard of Procedures for Compliance Testing of Unlicensed Wireless Devices,</I> June 27, 2013; IBR approved for §§ 15.31(a) and 15.37(s).</P>
<P>(e) Society of Cable Telecommunications Engineers (SCTE), 140 Philips Road, Exton, PA 19341; website: <I>www.scte.org</I></P>
<P>(1) SCTE 28 2003 (formerly DVS 295): “Host-POD Interface Standard,” 2003; IBR approved for § 15.123.</P>
</DIV8>`;

test("IBR section parses publishers, numbers, editions and sections; resellers skipped", () => {
  const p = parseIbr(IBR_XML);
  assert.deepEqual(p.map((x) => x.publisher), ["American National Standards Institute (ANSI)", "Cable Television Laboratories, Inc.", "Institute of Electrical and Electronic Engineers (IEEE)", "Society of Cable Telecommunications Engineers (SCTE)"]);
  const ansi = p[0].standards[0];
  assert.equal(ansi.designation, "ANSI C63.17-2013");
  assert.equal(ansi.number, "ANSI C63.17");
  assert.equal(ansi.edition, "2013");
  assert.deepEqual(ansi.approvedFor, ["15.31"]);
  assert.equal(p[0].website, "https://webstore.ansi.org/");
  assert.equal(p[1].standards[0].edition, "2008");
  assert.deepEqual(p[2].standards[0].approvedFor, ["15.31(a)", "15.37(s)"]);
  assert.equal(p[2].bodyKey, "ieee");
  assert.equal(p[3].standards[0].title, "Host-POD Interface Standard");
  assert.equal(p[3].standards[0].edition, "2003");
});

test("designations split into number and edition", () => {
  assert.deepEqual(splitDesignation("IEC 61000-4-2:2008"), { number: "IEC 61000-4-2", edition: "2008" });
  assert.deepEqual(splitDesignation("IEEE 1789-2015"), { number: "IEEE 1789", edition: "2015" });
  assert.deepEqual(splitDesignation("ASTM E308-22"), { number: "ASTM E308", edition: "22" });
  assert.deepEqual(splitDesignation("LM-79-19"), { number: "LM-79", edition: "19" });
  assert.deepEqual(splitDesignation("IEC 62471"), { number: "IEC 62471", edition: null });
});

test("ibr_standards filters by section and reports parts without an IBR section", async () => {
  const restore = mockFetch(async (u) => {
    const url = decodeURIComponent(String(u));
    if (url.includes("/search/v1/results")) return url.includes("hierarchy[part]=68") ? ok({ results: [] }) : ok({ results: [{ hierarchy: { title: "47", part: "15", section: "15.38" }, headings: { section: "<strong>Incorporation by reference</strong>." } }] });
    if (url.includes("titles.json")) return ok({ titles: [{ number: 47, up_to_date_as_of: "2026-10-13" }] });
    if (url.includes("section=15.31")) return ok("<DIV8><HEAD>§ 15.31 Measurement standards.</HEAD><P>(a) The following measurement procedures are incorporated by reference into § 15.38.</P></DIV8>");
    return ok(IBR_XML);
  });
  try {
    const all = await ibrStandards({ title: 47, section: "15.38" });
    assert.equal(all.count, 4);
    assert.match(all.copyright, /copyrighted/);
    const f = await ibrStandards({ title: 47, section: "15.31" });
    assert.deepEqual(f.publishers.flatMap((p) => p.standards.map((s) => s.designation)), ["ANSI C63.17-2013", "ANSI C63.10-2013"]);
    const none = await ibrStandards({ title: 47, part: "68" });
    assert.equal(none.ibrSection, null);
    await assert.rejects(ibrStandards({ title: 47 }), /Give part/);
  } finally { restore(); }
});

test("standards_link builds links; product pages are dropped when missing and flagged when unverifiable", async () => {
  assert.equal(normalizeBody("ULSE"), "ul");
  assert.equal(normalizeBody("Institute of Electrical and Electronics Engineers"), "ieee");
  await assert.rejects(standardsLink({ body: "xyz", number: "1" }), /Unknown standards body/);
  let restore = mockFetch(async (u) => ok(String(u).includes("UL8750") ? "<title>UL 8750 | UL Standards &amp; Engagement</title>" : "<title>Buy UL Standards Online | UL Standards Catalog</title>"));
  try {
    const good = await standardsLink({ body: "UL", number: "8750" });
    assert.equal(good.links[0].kind, "product page");
    assert.equal(good.links[0].verified, true);
    const bad = await standardsLink({ body: "UL", number: "99999" });
    assert.ok(!bad.links.some((l) => l.kind === "product page"));
    assert.ok(bad.links.some((l) => l.url.startsWith("https://webstore.ansi.org/search/find?in=1&st=UL%2099999")));
  } finally { restore(); }
  restore = mockFetch(async () => ({ ok: false, status: 403, headers: new Map(), text: async () => "" }));
  try {
    const astm = await standardsLink({ body: "astm", number: "E308-22" });
    assert.equal(astm.links[0].url, "https://www.astm.org/standards/e308");
    assert.equal(astm.links[0].verified, false);
    assert.match(astm.links[0].verifyNote, /blocked/);
  } finally { restore(); }
  const iec = await standardsLink({ body: "IEC", number: "61000-4-2:2008", check: false });
  assert.deepEqual(iec.links.map((l) => l.url), ["https://webstore.iec.ch/en/products/?q=IEC%2061000-4-2", "https://webstore.ansi.org/search/find?in=1&st=IEC%2061000-4-2%3A2008"]);
  const ieee = await standardsLink({ body: "ieee", number: "802.15.4", check: false });
  assert.equal(ieee.links[0].kind, "catalog search");
});

test("IBR parsing handles 49 CFR 'into §§' wording and roman-numeral sub-items", () => {
  const x = `<P>(c) The Aluminum Association, 1525 Wilson Blvd., Arlington, VA 22209.</P>
<P>(1) Aluminum Standards and Data, Seventh Edition, June 1982, into §§ 172.102; 178.65.</P>
<P>(d) U.S. Environmental Protection Agency, 1200 Pennsylvania Ave NW, Washington, DC.</P>
<P>(1) <I>Method 1,</I> 2014; IBR approved for § 60.4.</P>
<P>(i) SW-846-6010D, Inductively Coupled Plasma-Optical Emission Spectrometry, Revision 5, July 2018; IBR approved for appendix A-5 to this part.</P>
<P>(ii) SW-846-6020B, Inductively Coupled Plasma-Mass Spectrometry, Revision 2, July 2014; IBR approved for appendix A-5 to this part.</P>`;
  const p = parseIbr(x);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].standards[0].approvedFor, ["172.102", "178.65"]);
  assert.equal(p[1].standards.length, 3);
  assert.equal(p[1].standards[2].designation, "SW-846-6020B");
  assert.match(p[1].standards[2].approvedForText, /appendix A-5/);
});

test("edge cases: regex-special ASTM numbers, LIKE wildcards, bad dates and parts, hex entities", async () => {
  const r = await standardsLink({ body: "ASTM", number: "E308(", check: false });
  assert.ok(r.links.length >= 1);
  assert.equal(xmlToText("<P>&#xB5;W/cm&#178;</P>"), "µW/cm²");
  await assert.rejects(ecfrGetSection({ title: 47, section: "15.109", date: "2026-02-30" }), /real date/);
  await assert.rejects(ecfrGetSection({ title: 47, section: "15.109", date: "2026-13-45" }), /real date/);
  await assert.rejects(ecfrSearch({ query: "laser", title: 21, part: "1040; x" }), /part must be/);
  await assert.rejects(federalRegisterSearch({ term: "laser", from: "2026-05-01", to: "2026-01-01" }), /on or before/);
  await assert.rejects(federalRegisterSearch({ cfrTitle: 47, cfrPart: "15 OR 1" }), /cfrPart/);
  await assert.rejects(fccGranteeLookup({ name: "%%%" }), /Give fccId/);
});
