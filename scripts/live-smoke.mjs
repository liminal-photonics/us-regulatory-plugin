// Live smoke test over stdio. SPEC env var picks the server (default: local src). Never prints keys.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const spec = process.env.SPEC;
const cmd = spec ? { command: "npx", args: ["-y", spec] } : { command: "node", args: ["src/index.js"] };
async function run(env, fn) {
  const c = new Client({ name: "smoke", version: "0" });
  await c.connect(new StdioClientTransport({ ...cmd, env }));
  try {
    await fn(async (n, a) => { const r = await c.callTool({ name: n, arguments: a }); return r.isError ? { ERROR: r.content[0].text } : JSON.parse(r.content[0].text); }, c);
  } finally { await c.close(); }
}
await run(process.env, async (call, c) => {
  console.log("TOOLS", (await c.listTools()).tools.map((t) => t.name).join(", "));
  console.log("STATUS", JSON.stringify(await call("regulatory_status", {})));
  const s = await call("ecfr_search", { query: "radiated emission limits", title: 47, part: "15", limit: 3 });
  console.log("ECFR_SEARCH total", s.total, s.results.map((r) => `${r.citation} ${r.heading}`).join(" / "));
  const g = await call("ecfr_get_section", { title: 47, section: "15.109" });
  console.log("ECFR_SECTION", g.citation, "as of", g.asOf, "| chars", g.text.length, "\n" + g.text.split("\n").slice(0, 8).join("\n"));
  console.log("ECFR_MISSING", JSON.stringify(await call("ecfr_get_section", { title: 47, section: "15.9999" })));
  const f = await call("federal_register_search", { agencies: ["federal-communications-commission"], cfrTitle: 47, cfrPart: "15", types: ["rule", "proposed_rule"], from: "2026-01-01", limit: 3 });
  console.log("FR total", f.total); for (const d of f.results) console.log("  ", d.published, d.type, "|", d.title.slice(0, 90), "| comments", d.commentsClose, "| effective", d.effective);
  console.log("FR_BAD_AGENCY", JSON.stringify(await call("federal_register_search", { agencies: ["not-an-agency"] })));
  const fg = await call("fcc_grantee_lookup", { fccId: "2AC7Z-ESPWROOM32" });
  console.log("FCC_GRANTEE", JSON.stringify(fg.results), "| dataset updated", fg.datasetUpdated);
  const gn = await call("fcc_grantee_lookup", { name: "nordic semiconductor" });
  console.log("FCC_BY_NAME", gn.results.map((r) => `${r.granteeCode} ${r.granteeName}`).join("; "));
  const gx = await call("fcc_grantee_lookup", { fccId: "2BZZZ-NOTREAL" });
  console.log("FCC_UNKNOWN results", gx.results.length);
  console.log("EMPTY_INPUT", JSON.stringify(await call("ecfr_search", { query: " " })));
});
