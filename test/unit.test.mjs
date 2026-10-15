import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchResult, xmlToText, ecfrSearch, ecfrGetSection } from "../src/ecfr.js";
import { normalizeDocument, federalRegisterSearch } from "../src/federalRegister.js";
import { normalizeMark, normalizeTsdr, normalizeClasses, buildSearchQuery, trademarkSearch, trademarkStatus } from "../src/uspto.js";
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
const TM_HIT = { id: "88117004", source: { id: "88117004", wordmark: "AZUKI", alive: false, statusCode: 710, statusDescription: "CANCELLED - SECTION 8", filedDate: "2018-09-14T00:00:00", registrationId: "5837950", registrationDate: "2019-08-20", internationalClass: ["IC 007"], goodsAndServices: ["(CANCELLED) IC 007: [ Electric egg beaters ]."], ownerName: ["Dongguan Xinrun Electronics Co., Ltd. (limited company (ltd.); CHINA)"], drawingCodeDescription: "(4) STANDARD CHARACTER MARK" } };
const TSDR = { trademarks: [{ status: { serialNumber: 97123456, filingDate: "2021-11-13", usRegistrationNumber: "", status: 602, statusDate: "2023-03-22", dateAbandoned: "2023-03-08", markElement: "AZUKI ZEN", markDrawDesc: "STANDARD CHARACTER MARK", extStatusDesc: "Abandoned because the applicant failed to respond.  To view all documents in this file, click on the Trademark Document Retrieval link at the top of this page.", tm5StatusDesc: "DEAD/APPLICATION/Refused/Dismissed or Invalidated", staff: { examiner: { name: "BELL, JUSTIN T" } }, lawOffAssigned: "LAW OFFICE 112" }, parties: { ownerGroups: { "11": [{ name: "CHIRU LABS, INC.", partyTypeDescription: "SUBSEQUENT OWNER BEFORE PUBLICATION", entityType: { description: "CORPORATION" } }, { name: "CHIRU LABS, INC.", partyTypeDescription: "SUBSEQUENT OWNER BEFORE PUBLICATION", entityType: { description: "CORPORATION" } }] } }, gsList: [{ internationalClasses: [{ code: "009", description: "Electrical and Scientific Apparatus" }] }], prosecutionHistory: [{ entryDate: "2023-03-22T04:00:00.000+0000", entryDesc: "ABANDONMENT NOTICE E-MAILED - FAILURE TO RESPOND" }] }] };

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

test("trademark search hit and TSDR status normalize", () => {
  const m = normalizeMark(TM_HIT);
  assert.equal(m.serialNumber, "88117004");
  assert.equal(m.live, false);
  assert.equal(m.filed, "2018-09-14");
  assert.match(m.owner, /Dongguan/);
  const s = normalizeTsdr(TSDR);
  assert.equal(s.mark, "AZUKI ZEN");
  assert.equal(s.status, "Abandoned because the applicant failed to respond.");
  assert.equal(s.owners.length, 1); // duplicates removed
  assert.deepEqual(s.classes, ["009 Electrical and Scientific Apparatus"]);
  assert.equal(s.recentHistory[0].date, "2023-03-22");
  assert.equal(normalizeTsdr({ trademarks: [] }), null);
});

test("trademark classes and query", () => {
  assert.deepEqual(normalizeClasses([9, "IC 042"]), ["009", "042"]);
  assert.throws(() => normalizeClasses([46]), /Nice class/);
  const q = buildSearchQuery("lumen", { liveOnly: true, classes: ["009"], limit: 5 });
  assert.deepEqual(q.query.bool.filter, [{ term: { alive: true } }, { terms: { IC: ["009"] } }]);
  assert.equal(q.size, 5);
});

test("trademark search reports an unexpected response shape instead of empty results", async () => {
  const restore = mockFetch(async () => ok({ message: "changed" }));
  try { await assert.rejects(trademarkSearch({ mark: "x" }), /unexpected response/); } finally { restore(); }
});

test("trademark_status without a key returns a clean message and makes no call", async () => {
  const saved = process.env.USPTO_TSDR_API_KEY;
  delete process.env.USPTO_TSDR_API_KEY;
  let called = false;
  const restore = mockFetch(async () => { called = true; return ok({}); });
  try {
    const r = await trademarkStatus({ serialNumber: "97123456" });
    assert.match(r.error, /USPTO_TSDR_API_KEY/);
    assert.equal(called, false);
    await assert.rejects(trademarkStatus({ serialNumber: "123" }), /8-digit/);
  } finally { restore(); if (saved) process.env.USPTO_TSDR_API_KEY = saved; }
});

test("TSDR key is sent as a header, and a 401 gives a key message", async () => {
  const saved = process.env.USPTO_TSDR_API_KEY;
  process.env.USPTO_TSDR_API_KEY = "test-key";
  let headers;
  const restore = mockFetch(async (u, init) => { headers = init.headers; return ok(TSDR); });
  try {
    const r = await trademarkStatus({ serialNumber: "97123456" });
    assert.equal(r.mark, "AZUKI ZEN");
    assert.equal(headers["USPTO-API-KEY"], "test-key");
  } finally { restore(); }
  const restore2 = mockFetch(async () => ok("unauthorized", 401));
  try { await assert.rejects(trademarkStatus({ serialNumber: "97123456" }), /rejected the API key/); } finally { restore2(); if (saved) process.env.USPTO_TSDR_API_KEY = saved; else delete process.env.USPTO_TSDR_API_KEY; }
});

test("429 and timeouts give clear messages", async () => {
  let restore = mockFetch(async () => ({ ok: false, status: 429, headers: new Map([["retry-after", "30"]]) }));
  try { await assert.rejects(request("eCFR", "https://x"), /rate limit reached; retry after 30 s/); } finally { restore(); }
  restore = mockFetch(async () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; });
  try { await assert.rejects(request("eCFR", "https://x"), /timed out after 20 s/); } finally { restore(); }
});
