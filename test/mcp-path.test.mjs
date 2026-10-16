// End-to-end tests through the MCP tool path (spawn the stdio server, call tools with the MCP client).
// Network-free: each test either fails validation before any request or uses a local mock server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseIbr } from "../src/standards.js";

const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));
let mock, base, fccQueries = [];
before(async () => {
  mock = http.createServer((req, res) => {
    fccQueries.push(decodeURIComponent(req.url));
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url.startsWith("/ecfr/versioner/v1/titles")) return res.end(JSON.stringify({ titles: [{ number: 33, up_to_date_as_of: "2026-10-01" }] }));
    if (req.url.startsWith("/ecfr/versioner/v1/full/")) {
      if (req.url.includes("section=183.5")) return res.end("<DIV8><HEAD>§ 183.5 Incorporation by reference.</HEAD><P>(a) Certain material is incorporated by reference into this part. The material is listed in § 183.607.</P></DIV8>");
      return res.end("<DIV8><HEAD>§ 183.607 Incorporation by reference.</HEAD><P>(a) The following standards are incorporated by reference.</P><P>(1) UL 1128, Marine Blowers.</P><P>(2) SAE J1171, External Ignition Protection.</P><P>(3) SAE J1527, Marine Fuel Hoses.</P></DIV8>");
    }
    if (req.url.startsWith("/ecfr/search") && req.url.includes("part%5D=183")) return res.end(JSON.stringify({ results: ["183.5", "183.607"].map((section) => ({ hierarchy: { part: "183", section }, headings: { section: "Incorporation by reference." } })) }));
    if (req.url.startsWith("/ecfr/search")) return res.end(JSON.stringify({ results: [], meta: { total_count: 0 } }));
    if (req.url.startsWith("/fr/")) return res.end(JSON.stringify({ count: 0, results: [] }));
    res.end(req.url.includes("/api/views/") ? JSON.stringify({ rowsUpdatedAt: 1616371200 }) : JSON.stringify([{ grantee_code: "BCG", grantee_name: "Apple Inc." }]));
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

async function call(name, args) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, FCC_OPENDATA_BASE: base, ECFR_API_BASE: `${base}/ecfr`, FEDERAL_REGISTER_API_BASE: `${base}/fr` } }));
  try { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; } finally { await c.close(); }
}

test("MCP fcc_grantee_lookup: malformed FCC IDs are rejected with a clear message", async () => {
  for (const bad of ["2AC7Z--ESP32", "2A-C7ZESP32", "B-CGE3091A", "2AC7Z", "BCG", "2AC7Z-", "BCG-", "-BCGE3091A", "2AC7Z-" + "X".repeat(15)]) {
    const r = await call("fcc_grantee_lookup", { fccId: bad });
    assert.equal(r.isError, true, bad);
    assert.match(r.text, /fccId|FCC ID/, bad);
  }
});

test("MCP fcc_grantee_lookup: 3- and 5-character grantee codes split correctly", async () => {
  for (const [id, g, p] of [["BCG-E3091A", "BCG", "E3091A"], ["bcge3091a", "BCG", "E3091A"], ["2AC7Z-ESP32WROVER", "2AC7Z", "ESP32WROVER"], ["2ac7z esp32-wroom", "2AC7Z", "ESP32-WROOM"]]) {
    const r = JSON.parse((await call("fcc_grantee_lookup", { fccId: id })).text);
    assert.equal(r.query.granteeCode, g, id);
    assert.equal(r.query.productCode, p, id);
  }
});

test("IBR parser: '; approved for', 'incorporation by reference approved for' and no-clause sections are counted", () => {
  const xml = `<P>(a) NEMA, 1300 17th St.; website: <I>www.nema.org.</I></P><P>(1) ANSI Z535.4-2011(R2017), <I>Product Safety Signs,</I> approved October 20, 2017; approved for §§ 1243.6 and 1243.7.</P><P>(2) [Reserved]</P>
<P>(b) ASTM International, 100 Barr Harbor Drive</P><P>(1) ASTM D4986-98, Standard Test Method, incorporation by reference approved for § 32.57-10.</P>`;
  const p = parseIbr(xml);
  assert.equal(p.reduce((n, x) => n + x.standards.length, 0), 2);
  assert.deepEqual(p[0].standards[0].approvedFor, ["1243.6", "1243.7"]);
  const old = `<P>(a) The following standards are incorporated by reference.</P><P>(1) AMCA Standard 210-74, Figure 12.</P><P>(2) UL Standard 1128, Underwriters Laboratories.</P>`;
  assert.equal(parseIbr(old).length, 0);
  assert.equal(parseIbr(old, true)[0].standards.length, 2);
  assert.equal(parseIbr(old, true)[0].publisher, null);
});

test("MCP ecfr_search: zero hits explain that every word must match", async () => {
  const r = JSON.parse((await call("ecfr_search", { query: "2.4 GHz digital modulation", title: 47, part: "15" })).text);
  assert.equal(r.total, 0);
  assert.match(r.hint, /matches all words/);
});

test("MCP ecfr_get_section: dates before 2017-01-03 point to the annual CFR instead of 'no current text'", async () => {
  const r = await call("ecfr_get_section", { title: 47, section: "15.109", date: "2015-01-01" });
  assert.equal(r.isError, true);
  assert.match(r.text, /starts on 2017-01-03.*govinfo/);
});

test("MCP federal_register_search: a term search is ordered by relevance by default; order is validated", async () => {
  fccQueries = [];
  const r = JSON.parse((await call("federal_register_search", { term: "lithium batteries" })).text);
  assert.equal(r.order, "relevance");
  assert.ok(fccQueries.some((q) => q.includes("order=relevance")));
  const bad = await call("federal_register_search", { term: "x", order: "random" });
  assert.equal(bad.isError, true);
});

test("MCP ibr_standards: for a whole part, the IBR section that has entries is shown, not an empty pointer section", async () => {
  const r = JSON.parse((await call("ibr_standards", { title: 33, part: "183" })).text);
  assert.equal(r.ibrSection, "33 CFR 183.607");
  assert.equal(r.count, 3);
  assert.deepEqual(r.otherIbrSections, ["33 CFR 183.5"]);
});

test("IBR parser: publisher names stop before postal and phone details", () => {
  const xml = `<P>(a) International Organization for Standardization, Case postale 56, CH·1211, Geneve 20, Switzerland, telephone +41-22-749-0111.</P><P>(1) ISO/IEC 27001:2013, Information security, IBR approved for § 170.599.</P>`;
  assert.equal(parseIbr(xml)[0].publisher, "International Organization for Standardization");
});
