// Reliability fixes (audit 2026-10-17): the status tool reports the plugin version and git commit, and every
// result carries retrievedAt plus the plugin version. Network-free: data sources point at a closed local port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { pluginVersion, stamp } from "../src/version.js";

const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const DEAD = "http://127.0.0.1:9";
async function client(extra = {}) {
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, ECFR_API_BASE: DEAD, FCC_OPENDATA_BASE: DEAD, FEDERAL_REGISTER_API_BASE: DEAD, US_REGULATORY_TIMEOUT_MS: "2000", ...extra } }));
  return c;
}
const body = (r) => JSON.parse(r.content[0].text);

test("status tool reports plugin name, version and git commit", async () => {
  const c = await client({ PLUGIN_GIT_SHA: "abc1234def".padEnd(40, "0") });
  try {
    const r = await c.callTool({ name: "regulatory_status", arguments: {} });
    const s = body(r);
    assert.equal(s.pluginName, PKG.name);
    assert.equal(s.plugin.name, PKG.name);
    assert.equal(s.version, PKG.version);
    assert.equal(s.version, "0.2.0");
    assert.equal(s.gitSha, "abc1234def".padEnd(40, "0"));
    assert.equal(s.gitShaSource, "PLUGIN_GIT_SHA");
    assert.match(s.retrievedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  } finally { await c.close(); }
});

test("every tool result is stamped with retrievedAt and plugin version", async () => {
  const c = await client();
  try {
    const r = await c.callTool({ name: "ecfr_get_section", arguments: { title: 47, section: "not-a-section" } });
    if (r.isError) return assert.ok(r.content[0].text.length > 0); // errors stay plain text
    const s = body(r);
    assert.match(s.retrievedAt, /Z$/);
    assert.equal(s.plugin.version, "0.2.0");
    assert.ok(s.plugin.gitSha);
  } finally { await c.close(); }
});

test("server advertises the package.json version, and mcp.json pins a tag", async () => {
  const c = await client();
  try { assert.equal(c.getServerVersion().version, PKG.version); } finally { await c.close(); }
  const m = readFileSync(new URL("../mcp.json", import.meta.url), "utf8");
  assert.match(m, /#v0\.2\.0"/);
  const p = JSON.parse(readFileSync(new URL("../.cursor-plugin/plugin.json", import.meta.url), "utf8"));
  assert.equal(p.version, PKG.version);
});

test("stamp wraps arrays and keeps objects", () => {
  const a = stamp([1, 2]);
  assert.deepEqual(a.result, [1, 2]);
  assert.ok(a.retrievedAt);
  const o = stamp({ x: 1 });
  assert.equal(o.x, 1);
  assert.equal(o.plugin.version, pluginVersion().version);
});

test("ecfr_get_section pages long sections instead of silently cutting them", async () => {
  const { ecfrGetSection } = await import("../src/ecfr.js");
  const long = "§ 1040.10 Laser products.\n" + "x".repeat(45000) + "END";
  const xml = `<DIV8 N="1040.10" TYPE="SECTION"><HEAD>§ 1040.10 Laser products.</HEAD><P>${"x".repeat(45000)}END</P></DIV8>`;
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const ok = (b) => ({ ok: true, status: 200, headers: new Map(), json: async () => b, text: async () => (typeof b === "string" ? b : JSON.stringify(b)) });
    return String(url).includes("titles.json") ? ok({ titles: [{ number: 21, up_to_date_as_of: "2026-10-15" }] }) : ok(xml);
  };
  try {
    const p1 = await ecfrGetSection({ title: 21, section: "1040.10" });
    assert.equal(p1.truncated, true);
    assert.equal(p1.offset, 0);
    assert.equal(p1.nextOffset, 20000);
    assert.ok(p1.totalLength > 45000);
    assert.match(p1.text, /\[truncated: characters 0-20000 of \d+; call again with offset 20000/);
    let text = "", o = 0, pages = 0;
    for (;;) {
      const p = await ecfrGetSection({ title: 21, section: "1040.10", offset: o });
      text += p.text.replace(/\n\[truncated:[^\]]*\]$/, ""); pages++;
      if (!p.truncated) { assert.equal(p.nextOffset, null); break; }
      o = p.nextOffset;
    }
    assert.equal(pages, 3);
    assert.equal(text.length, p1.totalLength);
    assert.ok(text.endsWith("END"));
    await assert.rejects(ecfrGetSection({ title: 21, section: "1040.10", offset: -1 }), /offset must be/);
    await assert.rejects(ecfrGetSection({ title: 21, section: "1040.10", offset: 999999 }), /past the end/);
    void long;
  } finally { globalThis.fetch = real; }
});
