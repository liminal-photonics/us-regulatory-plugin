#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ecfrSearch, ecfrGetSection } from "./ecfr.js";
import { federalRegisterSearch } from "./federalRegister.js";
import { trademarkSearch, trademarkStatus } from "./uspto.js";
import { status } from "./core.js";

const TOOLS = [
  {
    name: "ecfr_search",
    description: "Full-text search of the current Code of Federal Regulations (eCFR). Optional title/part filters, e.g. title 47 part 15 for FCC Part 15.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 }, title: { type: "integer", minimum: 1, maximum: 50 }, part: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } }, required: ["query"] },
  },
  {
    name: "ecfr_get_section",
    description: "Get the current text of one CFR section, e.g. title 47 section 15.109. Optional date (YYYY-MM-DD) for a past version.",
    inputSchema: { type: "object", properties: { title: { type: "integer", minimum: 1, maximum: 50 }, section: { type: "string", minLength: 1, description: 'part.section, e.g. "15.109"' }, date: { type: "string" } }, required: ["title", "section"] },
  },
  {
    name: "federal_register_search",
    description: "Search Federal Register documents (rules, proposed rules, notices) by term, agency slug, CFR title/part and publication date range. Returns effective and comment-close dates.",
    inputSchema: {
      type: "object",
      properties: {
        term: { type: "string" },
        agencies: { type: "array", items: { type: "string" }, description: 'Agency slugs, e.g. "federal-communications-commission", "patent-and-trademark-office"' },
        types: { type: "array", items: { type: "string", enum: ["rule", "proposed_rule", "notice", "presidential_document"] } },
        cfrTitle: { type: "integer" }, cfrPart: { type: "string" },
        from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
    },
  },
  {
    name: "trademark_search",
    description: "Knockout search of USPTO trademark records by word mark (exact, fuzzy and prefix). Live marks only by default; optional Nice classes. Not legal clearance.",
    inputSchema: { type: "object", properties: { mark: { type: "string", minLength: 1 }, liveOnly: { type: "boolean", default: true }, classes: { type: "array", items: { type: "integer", minimum: 1, maximum: 45 } }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, required: ["mark"] },
  },
  {
    name: "trademark_status",
    description: "USPTO TSDR case status for one serial number: status, owner, classes, recent prosecution history. Needs USPTO_TSDR_API_KEY.",
    inputSchema: { type: "object", properties: { serialNumber: { type: "string", minLength: 8 } }, required: ["serialNumber"] },
  },
  { name: "regulatory_status", description: "Show which data sources are reachable and which keys are configured.", inputSchema: { type: "object", properties: {} } },
];

const HANDLERS = {
  ecfr_search: ecfrSearch,
  ecfr_get_section: async (a) => (await ecfrGetSection(a)) || { error: `No current text found for ${a.title} CFR ${a.section}.` },
  federal_register_search: federalRegisterSearch,
  trademark_search: trademarkSearch,
  trademark_status: trademarkStatus,
  regulatory_status: status,
};

const server = new Server({ name: "us-regulatory", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    const h = HANDLERS[name];
    if (!h) throw new Error(`Unknown tool ${name}`);
    return { content: [{ type: "text", text: JSON.stringify(await h(a), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
await server.connect(new StdioServerTransport());
