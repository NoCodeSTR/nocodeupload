# NoCode Upload — Product Vision

> Purpose of this doc: preserve the product strategy so future agents (and future Sean) don't
> shrink NoCode Upload back into "just an upload tool." Read alongside [`HANDOFF.md`](./HANDOFF.md).

## Core vision

NoCode Upload is **submission infrastructure** — a platform that:

- **Collects files** (photos, videos, documents) into storage the customer already owns,
- **Collects structured answers** (custom fields, sections, conditional questions),
- **Carries hidden context** (record IDs, property IDs, cleaner IDs via URL prefills / hidden fields),
- **Personalizes forms** per recipient using connected Airtable records,
- **Routes submissions** to the right people/channels,
- **Triggers workflows** (notifications, webhooks),
- **Writes to existing systems** (creates/updates Airtable records),
- and above all **makes operational follow-up easier.**

Positioning language to keep using:
- *"Every submission triggers action."*
- *"Collect files, capture context, trigger workflows."*
- *"Submission infrastructure."*
- *"Operational workflow intake."*

The guiding filter for every feature: **"What action becomes easier after this submission?"**
If a proposed feature doesn't make a downstream action easier, it's probably scope creep toward a
generic form builder — deprioritize it.

## Beachhead market: Short-Term Rentals (STR)

STR is the starting niche because it is **saturated with file-plus-context intake tied to a
property record**, and each flow ends in an action:

- Cleaner **completion reports** (before/after photos + a checklist)
- **Damage reports** (guest or cleaner)
- **Maintenance requests** (photo + description → work order)
- **Guest issue reports**
- **Owner walkthroughs**
- **Before/after documentation**
- **Supply / restock reports**
- **Video routing** (walkthroughs to the right place)
- **Property-specific workflows** — one form, hundreds of properties, each submission tied to the
  right property record and folder.

**Why dogfood via StayWorkAndPlay / NoCode STR first:** Sean operates in STR, so the product can
be used and pressure-tested on real turnovers, real cleaners, and real Airtable property tables
before selling outward. Depth in one vertical (folders per property, per-property notifications,
Airtable write-back) is the wedge — not breadth.

## Wider market (later)

The same "files + structured context → action, written into your systems" pattern generalizes to:
Property management · Real estate · Maintenance companies · Events · Construction · Insurance ·
Education · Client intake · Field services · Media collection.

These are **later**. Do not build broadly before STR is deep and proven.

## Product moat (most defensible advantages)

1. **Files land in storage the customer owns** (their Google Drive) — not a walled garden. Low
   trust barrier, no data lock-in, no storage cost to us.
2. **Large-file support** via server-relayed resumable uploads (walkthrough videos, big photo
   batches).
3. **Airtable as both a source and a destination** — read context in, write results back.
4. **Connected records** — one dynamic form personalizes and routes per record.
5. **One dynamic form reused across many** properties / guests / cleaners / owners.
6. **Hidden record IDs & prefills** — the form silently knows which property/guest it's for.
7. **Dynamic recipients** — text/email a person pulled from the connected record (e.g. the cleaner).
8. **Multiple upload boxes with separate destinations** (or one tidy per-submission folder).
9. **Submission visibility & delivery reliability** — inbox, per-channel delivery logs, retry.
10. **Templates for operational use cases** (planned) — pre-wired STR flows for instant value.

A generic form builder (Typeform/Jotform) has none of #1, #3, #4, #6, #7, #8 in combination. That
combination — *files into your own storage, personalized/routed by your own records, written back
to your own systems* — is the moat.

## Product principles

- **The submission is the product; files are optional parts of it.**
- **Airtable is both a source of context and an optional destination.**
- **Do not force customers into a new operational system** — fit into the one they already run.
- **Reliability and observability matter more than adding endless field types.** (Delivery logs,
  retry, honest error surfacing beat a 20th input type.)
- **Templates should reduce time-to-value.**
- **Build depth-first for STR before expanding broadly.**
- **Avoid becoming a generic Typeform/Jotform competitor.**
- **Every new feature must answer: "What action becomes easier after this submission?"**
