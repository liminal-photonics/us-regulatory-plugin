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
  const t = await call("trademark_search", { mark: "lumen", classes: [9], limit: 3 });
  console.log("TM_SEARCH total", t.total); for (const m of t.results) console.log("  ", m.serialNumber, m.mark, "|", m.status, "|", m.owner, "|", m.classes.join(","));
  const st = await call("trademark_status", { serialNumber: t.results[0]?.serialNumber || "97123456" });
  console.log("TM_STATUS", st.serialNumber, st.mark, "|", st.statusSummary, "|", st.status, "| owners", (st.owners || []).map((o) => o.name).join("; "), st.error || "");
  console.log("EMPTY_INPUT", JSON.stringify(await call("trademark_search", { mark: " " })));
});
const env2 = { ...process.env }; delete env2.USPTO_TSDR_API_KEY;
await run(env2, async (call) => {
  console.log("NOKEY STATUS", JSON.stringify((await call("regulatory_status", {})).trademarkStatus));
  console.log("NOKEY TM_STATUS", JSON.stringify(await call("trademark_status", { serialNumber: "97123456" })).slice(0, 200));
  const t = await call("trademark_search", { mark: "lumen", limit: 1 });
  console.log("NOKEY TM_SEARCH still works:", t.results.length, "result");
});
