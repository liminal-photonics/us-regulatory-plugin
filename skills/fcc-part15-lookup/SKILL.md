---
name: fcc-part15-lookup
description: Use when the user asks what FCC Part 15 (47 CFR Part 15) says about a device, such as emission limits, unintentional vs. intentional radiators, labeling, user-manual statements, or which section applies.
---

# FCC Part 15 lookup

Answer from the current regulation text, with citations, using the `us-regulatory` MCP tools.

## Steps

1. Find candidate sections with `ecfr_search` (`title: 47`, `part: "15"`) using the user's terms (e.g. "radiated emission limits", "labelling requirements", "information to the user").
2. Read each relevant section with `ecfr_get_section` (`title: 47`, `section: "15.109"` etc.). Quote the exact language and table values that answer the question, not a paraphrase from memory.
3. Check related sections the text points to (definitions in 15.3, measurement rules in 15.31–15.35, labeling in 15.19, user information in 15.105, equipment authorization in Part 2).
4. If the user names a module or radio by FCC ID, call `fcc_grantee_lookup` to identify the grantee. It does not confirm the grant itself (that data is not available key-free); point the user to FCC EAS for the grant and its test reports.
5. Check for pending changes with `federal_register_search` (`agencies: ["federal-communications-commission"]`, `cfrTitle: 47`, `cfrPart: "15"`, recent `from` date).

## Output

- The answer in plain language, then the quoted text with citation (e.g. "47 CFR 15.109(a)") and the eCFR "as of" date.
- Units exactly as written (e.g. microvolts/meter at 3 meters). Do not convert units unless asked, and show the math if you do.
- Any pending or recent rule changes found.
- A note that the eCFR is an editorial compilation, not the official legal edition, and that equipment authorization questions (SDoC vs. certification) should be confirmed with a test lab or TCB.

## Related

For product or company name checks (trademark knockout searches) and patent searches, use the companion **US Trademark & Patent Research** plugin (`us-ip`, https://github.com/liminal-photonics/us-ip-plugin). This plugin covers regulations only.
