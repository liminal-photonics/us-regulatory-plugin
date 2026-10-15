---
name: rule-change-watch
description: Use when the user wants to know about new or proposed federal rules affecting a CFR part, agency or topic, such as FCC equipment authorization changes, open comment periods, or rules taking effect soon.
---

# Rule change watch

Summarize recent and pending Federal Register activity for the user's scope.

## Steps

1. Pin the scope: CFR title and part (e.g. 47 CFR 15, 47 CFR 2), agency slug (e.g. `federal-communications-commission`), and/or a search term. Default lookback is 90 days; use the user's date if given.
2. Call `federal_register_search` with `types: ["rule", "proposed_rule"]`, the scope and `from`. Run a second search with `types: ["notice"]` only if the user wants notices.
3. For each relevant document, pull out: type, title, published date, effective date (final rules), comment deadline (proposed rules), docket numbers, CFR parts affected, and link.
4. For a final rule that changes text you care about, read the updated section with `ecfr_get_section`. The eCFR may lag the Federal Register by a few days; if the new text is not there yet, say so.

## Output

Group by **Open for comment** (with deadline), **Taking effect** (with date), and **Recently final**. Lead with anything due in the next 30 days. One or two plain-language lines per item on what it changes, plus the link. Say clearly when nothing matched.
