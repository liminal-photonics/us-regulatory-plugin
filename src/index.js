#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ecfrSearch, ecfrGetSection } from "./ecfr.js";
import { federalRegisterSearch } from "./federalRegister.js";
import { fccGranteeLookup } from "./fcc.js";
import { ibrStandards, standardsLink, BODIES } from "./standards.js";
import { status } from "./core.js";
import { pluginVersion, stamp, versionInfo } from "./version.js";

const TOOLS = [
  {
    name: "ecfr_search",
    description: "Full-text search of the current Code of Federal Regulations (eCFR); every word must appear in a section, so use few, regulation-style words. Optional title/part filters, e.g. title 47 part 15 for FCC Part 15.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 }, title: { type: "integer", minimum: 1, maximum: 50 }, part: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } }, required: ["query"] },
  },
  {
    name: "ecfr_get_section",
    description: "Get the current text of one CFR section, e.g. title 47 section 15.109. Optional date (YYYY-MM-DD, 2017-01-03 or later) for a past version. Long sections are paged: when truncated is true, call again with offset = nextOffset and read the whole section before relying on it.",
    inputSchema: { type: "object", properties: { title: { type: "integer", minimum: 1, maximum: 50 }, section: { type: "string", minLength: 1, description: 'part.section, e.g. "15.109"' }, date: { type: "string" }, offset: { type: "integer", minimum: 0, description: "Character offset for long sections; use nextOffset from the previous call. Text comes in 20,000-character pages." } }, required: ["title", "section"] },
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
        order: { type: "string", enum: ["relevance", "newest", "oldest"], description: "Default: relevance when a term is given, else newest." },
        cfrTitle: { type: "integer" }, cfrPart: { type: "string" },
        from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      },
    },
  },
  {
    name: "fcc_grantee_lookup",
    description: "Look up an FCC equipment authorization grantee by FCC ID (uses its grantee-code prefix), grantee code or company name, from the FCC Open Data grantee registry. That registry was last refreshed in March 2021 and does not show individual FCC ID grants; the result links to FCC EAS to confirm.",
    inputSchema: { type: "object", properties: { fccId: { type: "string" }, granteeCode: { type: "string" }, name: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } } },
  },
  {
    name: "ibr_standards",
    description: "List standards incorporated by reference (IBR) in a CFR part, from the part's eCFR \"Incorporation by reference\" section (e.g. 47 CFR 15.38): publisher, designation, number, edition, title and the sections each is approved for. Pass a section (e.g. 15.31) to list only the standards approved for it. Citations only; standard text is copyrighted.",
    inputSchema: { type: "object", properties: { title: { type: "integer", minimum: 1, maximum: 50 }, part: { type: "string" }, section: { type: "string", description: 'e.g. "15.38" (the IBR section) or "15.31" (filter)' } }, required: ["title"] },
  },
  {
    name: "standards_link",
    description: "Official purchase/info links for a standard: a checked product page where the body has a stable URL (UL, ASTM, IEEE, NFPA), otherwise the body's catalog search, plus ANSI Webstore search. Links only; standard text is copyrighted.",
    inputSchema: { type: "object", properties: { body: { type: "string", enum: Object.keys(BODIES) }, number: { type: "string", minLength: 1, description: 'e.g. "61010-1", "C63.4-2014", "E308-22"' }, edition: { type: "string" }, check: { type: "boolean", default: true } }, required: ["body", "number"] },
  },
  { name: "regulatory_status", description: "Show which data sources are reachable, and the plugin version and git commit that is running.", inputSchema: { type: "object", properties: {} } },
];

const HANDLERS = {
  ecfr_search: ecfrSearch,
  ecfr_get_section: async (a) => (await ecfrGetSection(a)) || { error: `No text found for ${a.title} CFR ${a.section}${a.date ? ` as of ${a.date}` : " in the current eCFR"}. Check the section number (it may be reserved, removed or not yet in effect); ecfr_search can find the right one.` },
  federal_register_search: federalRegisterSearch,
  fcc_grantee_lookup: fccGranteeLookup,
  ibr_standards: ibrStandards,
  standards_link: standardsLink,
  regulatory_status: async (a) => ({ ...(await status(a)), ...versionInfo() }),
};

const server = new Server({ name: "us-regulatory", version: pluginVersion().version || "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    const h = HANDLERS[name];
    if (!h) throw new Error(`Unknown tool ${name}`);
    return { content: [{ type: "text", text: JSON.stringify(stamp(await h(a)), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
await server.connect(new StdioServerTransport());
