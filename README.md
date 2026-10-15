# US Regulatory & Trademark Research

A Grok Bot / Cursor plugin for US regulatory and trademark research. It bundles a local MCP server and three skills.

<img src="assets/logo.svg" width="96" alt="logo">

## What you get

**MCP tools** (server `us-regulatory`, local stdio, Node 18+):

| Tool | Source | Key |
| --- | --- | --- |
| `ecfr_search` | Full-text search of the current Code of Federal Regulations, with optional title/part filters | none |
| `ecfr_get_section` | Current (or dated) text of one section, e.g. 47 CFR 15.109, tables included | none |
| `federal_register_search` | Rules, proposed rules and notices by term, agency, CFR title/part and date; returns effective and comment-close dates | none |
| `trademark_search` | Knockout search of USPTO trademarks by word mark (exact, fuzzy, prefix), live-only by default, optional Nice classes | none |
| `trademark_status` | USPTO TSDR status for a serial number: status, owners, classes, recent history | `USPTO_TSDR_API_KEY` |
| `regulatory_status` | Shows which sources are reachable and which keys are set | none |

**Skills**

- `fcc-part15-lookup`: answer FCC Part 15 questions from the current text, with citations
- `trademark-knockout`: quick USPTO conflict screen with a clear "not legal clearance" disclaimer
- `rule-change-watch`: open comment periods, upcoming effective dates and recent final rules for a CFR part or agency

## Install

Install **US Regulatory & Trademark Research** from the Grok Bot or Cursor plugin marketplace. To run it by hand in any MCP client:

```json
{
  "mcpServers": {
    "us-regulatory": {
      "command": "npx",
      "args": ["-y", "github:liminal-photonics/us-regulatory-plugin"],
      "env": { "USPTO_TSDR_API_KEY": "..." }
    }
  }
}
```

## API key (optional, bring your own)

Everything except `trademark_status` works with no key. The repo stores no keys, and calls go straight from your machine to the government APIs.

**USPTO TSDR key** (for `trademark_status`)
1. Create or sign in to a USPTO.gov account at https://account.uspto.gov.
2. Open the API Manager at https://account.uspto.gov/api-manager/ and request a TSDR API key.
3. Put it in `USPTO_TSDR_API_KEY` where your agent runs (the plugin's `mcp.json` reads `${env:USPTO_TSDR_API_KEY}`).

Without the key, `trademark_status` returns a clear message and a TSDR web link instead of failing.

## Examples

- "What are the FCC Part 15 radiated emission limits for a Class B device?"
- "Show me 47 CFR 15.19 labeling requirements."
- "Any FCC rules or proposed rules affecting 47 CFR Part 15 since July?"
- "Knockout search the name LUMEN for class 9 electronics."
- "What's the status of trademark serial 97123456?"

## Data notes

- **eCFR** is an editorial compilation updated daily. It is not the official legal edition (that is the annual CFR on govinfo). Section text is capped at 20,000 characters.
- **Federal Register** results are newest first. Agency filters use slugs such as `federal-communications-commission` or `patent-and-trademark-office`.
- **Trademark search** uses the public JSON endpoint behind USPTO's Trademark Search site (tmsearch.uspto.gov). It needs no key but isn't a documented API, so USPTO can change it without notice. If it changes, the tool says so instead of returning wrong data.
- **Not legal advice.** Trademark results are a knockout screen of USPTO records only, not clearance: they miss common-law, state and foreign rights, and they are not a likelihood-of-confusion opinion.
- Requests time out after 20 s (`US_REGULATORY_TIMEOUT_MS` changes this). A rate-limited source (HTTP 429) returns a clear message.

## Development

```bash
npm install
npm test               # offline unit tests (fixtures trimmed from real API responses)
USPTO_TSDR_API_KEY=... npm run live   # live smoke test over stdio
```

## License

MIT © Liminal Photonics
