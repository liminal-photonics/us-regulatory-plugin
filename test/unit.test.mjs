import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchResult, xmlToText, ecfrSearch, ecfrGetSection } from "../src/ecfr.js";
import { normalizeDocument, federalRegisterSearch } from "../src/federalRegister.js";
import { splitFccId, normalizeGrantee, fccGranteeLookup } from "../src/fcc.js";
import { request } from "../src/http.js";

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
