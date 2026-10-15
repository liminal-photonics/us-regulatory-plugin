---
name: trademark-knockout
description: Use when the user wants a quick check of whether a product or company name conflicts with existing US trademarks, or the status of a USPTO application or registration.
---

# Trademark knockout search

A fast first screen against USPTO records. **This is not legal clearance.** Say so in every answer.

## Steps

1. Ask for the name and what it will be used on, then map that to Nice classes (e.g. 9 for electronics and software, 42 for SaaS and design services, 35 for retail). Include closely related classes.
2. Run `trademark_search` for the exact mark with `liveOnly: true` and the classes. Then search obvious variants: spacing and hyphens, plural/singular, phonetic spellings, and the dominant word of a multi-word name.
3. Run once more without the class filter to spot famous marks in any class.
4. For close hits, call `trademark_status` with the serial number (needs `USPTO_TSDR_API_KEY`; without it, give the TSDR link) to confirm current status and owner.

## Output

- A table of the closest live marks: mark, serial/registration number, status, owner, classes, and a one-line reason it is close (same word, sound-alike, same goods).
- A plain risk read: **clear-looking**, **some conflicts**, or **likely conflict**, with the reasons.
- This disclaimer, always: "This is a knockout search of USPTO records only. It is not legal clearance. It does not cover common-law (unregistered) use, state registrations, foreign rights, or a likelihood-of-confusion analysis. Have a trademark attorney run a full clearance search before you adopt or file the mark."
- Never say a mark is "available" or "safe to use".
