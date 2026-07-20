# The Founder Engineering Playbook

*Handed over by the outgoing CTO-of-record. Read this before you read the code.
If you only have ten minutes, read sections 1, 2, and 8.*

This document exists because this company's institutional memory lives in
artifacts, not in any person's head. That is unusual, it is survivable, and it
only works if documents like this one are treated as load-bearing. You — human
engineer or AI agent — are now part of a lineage. The code you inherit was
written carefully by contributors who are no longer here. Leave it the way you
found it: understandable by the next one.

---

## 1. Engineering Philosophy

**The product is a promise, and the promise is small.** Someone taps a link on
a phone in a cleaning closet, sends photos, and the right things happen: files
land in the owner's own Drive, the record updates, the right person gets
texted. Everything in this codebase exists to keep that promise. Nothing in
this codebase is more important than that promise.

Three convictions define how we build, and all three were *earned*, not chosen
from a book:

**We hold pointers, not property.** Files live in the customer's Drive. Records
live in the customer's Airtable. We store references and metadata. This started
as a cost decision and became the company's character: we have no storage
COGS, no data-custody liability, and no sync problems, because we never copy
what we can point to. When you design anything new, your first question is
"can we reference this instead of holding it?"

**The server tells the truth; the browser draws a picture.** The public upload
surface is anonymous and therefore hostile by definition. Every hidden field,
every select option, every visibility condition is re-resolved and re-validated
server-side at submit time. The client version is a preview, never an
authority. Any feature shipped with only its client half is an unfinished
feature.

**Nothing fails silently.** Every notification attempt — including *skips,
with reasons* — lands in `notification_deliveries`. Every job leaves events.
Every Postgres error is logged with all four fields, because we once lost a
day to an empty error message. When you add a side effect, you must answer:
where is its record, and where does a customer see it?

What should future engineers optimize for? **Recoverability over perfection.**
This system assumes things fail — Airtable rate-limits, webhooks 503, functions
die mid-write — and is built so failures are visible, bounded, and retryable.
A feature that works 99% of the time and fails loudly beats one that works
99.9% and fails silently.

---

## 2. Architectural Constitution

These rules exist because breaking them has a known, specific cost. Each one
has a scar behind it.

**The modular monolith is an asset, not a phase.** One deployment, one
database, one mental model. Engines are folders with facades
(`lib/engine/…`), not services. We extract boundaries when a *second consumer*
forces them to be honest — never speculatively. The Jobs Engine is a folder
and a cron route; it would work identically as a separate service, which is
exactly why it doesn't need to be one.

**Engines never import products.** `lib/engine/jobs/` knows nothing about
uploads. The Storage adapters know nothing about forms. Products register
handlers and adapters *into* engines; engines never reach up. The day an
engine imports product code, the platform is dead and we just have a big app.

**Least privilege is product strategy.** We run Google Drive on `drive.file`
only. That constraint forced app-owned folders — which became the per-property
folder *feature* — and bought us verification with no CASA audit, no user cap,
and no warning screen. When a new integration tempts you toward a broader
scope, remember: the narrow scope has paid for itself twice. Find the feature
hiding inside the constraint.

**Migrations are additive and self-recording.** `add column if not exists`,
new tables, new views. Destructive migrations wait until the code that needed
the old shape is provably gone. Every migration file ends by inserting itself
into the migration ledger. We once reconstructed production schema state from
chat transcripts; never again.

**Feature flags gate behavior; call sites hold the flag.** New risky behavior
ships dark (`JOBS_ENGINE_ENABLED`, `YOUTUBE_ENABLED`), and the branch lives at
the *call site*, not inside the new system — so flag-off means the new code
isn't even in the path. Rollback is a flag flip, not a revert war.

**Small, reversible PRs.** Every change should be describable in one sentence
and revertible in one action. The Jobs Engine — our biggest single build —
shipped as two PRs, each independently deployable and flag-inert.

**Intake never fails because downstream failed.** The severity order is:
intake > storage > record-keeping > notification. The rate limiter fails
open. Folder creation falls back to the parent. Notification errors never fail
the upload. The guest with the phone is the least recoverable moment in the
system; everything after them can be retried.

**Never claim exactly-once.** This system provides at-least-once execution
with idempotent handlers. The words "exactly once" may appear only next to
the words "idempotency key." Anyone who claims stronger must prove it.

**Payloads carry references, never secrets.** Credentials live encrypted in
the vault (`lib/crypto/tokens.ts`) and are resolved at execution time. Job
payloads, logs, and webhook bodies never contain tokens. There is a tripwire
in the Jobs Engine that enforces this; do not teach anything to route around
it.

**One templating language, everywhere.** `{{alias.Field}}` merge tags and
`{token}` variables behave identically in filenames, emails, SMS, Slack, and
success screens, through one two-pass renderer. A second templating syntax is
architecturally wrong by default, no matter how convenient.

---

## 3. Repository Tour

Read in this order. Do not skip to the code.

1. **`AGENTS.md`** — the working rules for contributors (human and AI).
2. **`docs/HANDOFF.md`** — what the product is, what's deployed, current state.
3. **`docs/ARCHITECTURE.md`** — how the pieces fit.
4. **`docs/DECISIONS.md`** — the ADR log. *Why* things are the way they are.
   When something looks wrong, check here before "fixing" it — most strange
   things are load-bearing (the `__form` carrier row, the server relay, the
   two separate identity layers).
5. **`docs/MIGRATIONS.md`** + the migration ledger — schema truth.
6. **`docs/JOBS-ENGINE.md`**, **`docs/TECHNICAL-DEBT.md`** — operations and
   known debts (each debt is listed with its trigger condition; don't fix
   debts whose triggers haven't fired).

Then the code, in dependency order:

- **`lib/schemas.ts`** and **`lib/db-types.ts`** — the domain vocabulary.
- **`lib/links.ts`**, **`lib/submissions.ts`** — the two core entities.
- **`app/api/upload/initiate/route.ts`** then **`chunk/route.ts`** — the whole
  upload pipeline, including why the server relays bytes (CORS, ADR-4).
- **`lib/notifications/dispatch.ts`** — the single delivery choke point.
  Everything that notifies anyone flows through here. Keep it that way.
- **`lib/airtable/record-prefill.ts`** — the crown jewel: one form, thousands
  of properties, referenced-fields-only to the browser.
- **`lib/engine/jobs/`** — the durability layer.
- **`lib/providers/registry.ts`** — the adapter pattern every engine copies.

**Sources of truth:** GitHub `main` for code (never an archive, never a
workspace — we once nearly deployed a stale archive that would have reverted
security patches). The migration ledger for schema. `docs/DECISIONS.md` for
intent. Vercel env for configuration. The docs describe; `main` decides.

---

## 4. Engineering Workflow

The rhythm that has worked, from idea to cleanup:

1. **Read before writing.** Every good fix in this repo's history started with
   re-reading the actual implementation. Every bad theory (and there were
   several — see §8) started with pattern-matching from memory.
2. **Write the decision down first** if it's irreversible or strange — a short
   ADR in `docs/DECISIONS.md`. Five minutes now saves an archaeology session
   later.
3. **Implement narrow.** One concern per PR. If the diff needs "and" in its
   description, split it.
4. **Gate before push:** `tsc --noEmit` → `next lint` → `next build` →
   `vitest run`. All green, every time, no exceptions. The compiler is the
   only reviewer who never gets tired.
5. **Flag anything risky.** New behavior ships dark and is enabled
   deliberately, after the migration is confirmed applied.
6. **Verify behavior, not just compilation.** The build proves it compiles;
   only exercising the real flow proves it works. For anything touching
   Google, Airtable, or the public surface, run the actual flow (preview
   deploy + the staging database) before trusting it.
7. **Observe in production.** Watch the delivery ledger, the jobs table, the
   runtime logs. A change isn't done when it deploys; it's done when it has
   been *seen working* with real traffic.
8. **Clean up on a delay.** Legacy paths are deleted only after the new path
   has soaked. Deletion is a separate, boring PR.

---

## 5. Documentation Standards

**Must always exist and stay current:** `HANDOFF.md` (state of the world),
`DECISIONS.md` (the ADR log), `MIGRATIONS.md` + the ledger, `AGENTS.md`
(contributor rules), and one operations doc per engine that has operations
(`JOBS-ENGINE.md`, `RECOVERY.md`, `ABUSE-RUNBOOK.md`).

**ADRs** are for decisions that are irreversible, surprising, or expensive to
re-derive. Format: context, decision, alternatives, consequences, and — most
important — *the condition that should trigger reconsideration*. An ADR
without a reconsideration trigger is dogma.

**Migration history** is maintained by the migrations themselves (each file
records itself in the ledger) plus the human-readable manifest. If those two
ever disagree, the database ledger wins and the manifest gets fixed.

**For AI agents specifically:** you have no memory between sessions; the repo
*is* your memory. So: (1) update the docs in the same PR as the change —
stale docs are worse than no docs, because the next agent will trust them;
(2) write commit messages that explain *why*, since they are permanent and
chat transcripts are not; (3) when you discover something surprising, record
it where the next agent will look — a code comment for local surprises, an
ADR for global ones; (4) never "clean up" something you don't understand —
check `DECISIONS.md`, and if it's not there, ask, then document the answer.

---

## 6. Operational Philosophy

**Production changes:** every push to `main` deploys to every customer within
minutes. Respect that. Risky changes rehearse on a preview deployment against
the staging database first. The three recurring security invariants
(`include_granted_scopes: "false"`, the `isHttpUrl` redirect guards, tokens
never to the browser) are verified before every push — they have been
regressed by tooling before and the check costs ten seconds.

**Incidents:** stabilize, then understand, then fix — in that order.
Deactivating a link, suspending an account, or flipping a flag are all
one-action stabilizers; use them first. During diagnosis, trust evidence over
theory: this repo's history includes a confident root-cause diagnosis that was
disproven by a single `curl` (the "apex domain" picker theory — the URL bar
was just hiding `www.`). Run the cheap decisive test before shipping the
clever fix. And when you *are* wrong, revert the wrong fix and say so in the
commit message; a repo that records its dead ends protects its future.

**Rollbacks are designed, not improvised.** Every PR states its rollback in
advance. The best rollback is a flag; the second-best is a revert of one
small commit; needing more than that means the PR was too big.

**Migrations:** additive, idempotent (`if not exists`), self-recording, run
*before* the code that needs them is enabled. Destructive statements run in a
transaction with a `select` preview first.

**Flags:** temporary by intention. A flag that has been on for months with the
legacy path unused is cleanup debt — schedule the deletion.

---

## 7. Platform Vision

The platform is eight engines, six of which already exist in `lib/`:
**Variable** (one templating language), **Context** (records → values, the
one-form/many-properties primitive), **Rendering** (definition → any surface),
**Delivery** (channels + the ledger), **Storage** (provider adapters +
relay), **Vault** (credentials), **Jobs** (durability), and **Workflow**
(conditions → actions, currently growing verb by verb inside notification
rules).

Products are *compositions* of these engines with vertical-shaped defaults.
NoCodeUpload is intake-shaped. The next product should be built *against the
engines* — same vault, same delivery, same variables — and wherever it can't
reuse an engine cleanly, that friction is the platform telling you a boundary
is drawn wrong. Let the second product audit the architecture; don't audit it
speculatively.

Success in five years looks like this: a new vertical product is mostly
configuration — a definition format, some defaults, a skin — because context,
rendering, delivery, storage, and durability are already solved. The guest
experience contract never changes: someone taps a link, fills a form that
knows who they are, and the right things happen. Everything else is engine
room.

---

## 8. Common Failure Modes

Learned here, in this repo, sometimes the hard way:

**Fixing the symptom you can see instead of the mechanism you can't.** The
folder picker "worked for the owner, failed for everyone else" for weeks
because the owner's browser happened to hold a Google session. The fix
required understanding *why it ever worked*, not why it failed. When a bug
affects some users and not others, the difference between those users IS the
bug. Find it before writing code.

**Trusting a plausible theory because it explains the evidence you've
gathered so far.** Three consecutive wrong theories preceded the picker fix
(host mismatch, API key restrictions, Workspace policy). Each was reasonable;
each died to one cheap decisive test. Always ask: what is the cheapest
experiment that could *disprove* my theory? Run it first.

**"Simplifying" something load-bearing.** The `__form` carrier row, the
server relay, the two identity layers, referenced-fields-only context — all
look like complexity a smart refactorer would remove. Each one is a wall.
The repo's strangest structures are its most deliberate. Check `DECISIONS.md`
before demolishing.

**Claim-first, work-second.** The pre-Jobs claim functions marked work as
done *before* doing it — so a crash lost the work forever, silently. The
pattern is seductive because it prevents duplicates. Prefer: record intent
durably, do the work, acknowledge — and make the work idempotent. That's what
the Jobs Engine exists for; use it instead of inventing claim columns.

**Scope creep in a single PR.** Under deadline pressure, "while I'm in here"
is how a webhook fix ends up touching the auth layer. The repo's best changes
were boring and narrow; the scariest moments came from wide ones.

**Adding infrastructure to feel professional.** No Redis, no queue service,
no admin console, no staging pipeline beyond a preview URL and a scratch
database — not because those are bad, but because each was evaluated against
an actual trigger condition and the trigger hadn't fired. Infrastructure
added before its trigger is pure carrying cost. The triggers are written
down; honor them.

**Forgetting that consent screens, browsers, and third parties change under
you.** Google's granular-consent checkbox silently broke connections; Chrome's
URL display created a phantom bug; an archive format grew a nested directory
one day. The environment drifts. When something breaks with no deploy, look
outward first.

---

## 9. Advice to My Future Self (Sean, three years from now)

You built this by directing, testing, and deciding — not by writing code. That
worked because you did three things consistently: you tested what shipped
*personally*, you reported what you saw precisely (your screenshots and "it
works on my end but not hers" observations solved more bugs than any log
file), and you made the strategic calls yourself. Keep doing all three no
matter how large this gets. The day you stop personally using the product is
the day quality starts drifting.

Remember: the moat was never the code. The code is replaceable — you've
replaced its authors several times already. The moat is the accumulated
*decisions*: drive.file, customer-owned storage, context-aware forms, the
delivery ledger, one templating language. Protect decisions harder than code.

Resist: the big rewrite (someone will propose it; the answer is in §2), the
broader OAuth scope (someone will want "just read access"; the answer is
CASA), storing customer files "temporarily" (the answer is never), and the
enterprise deal that wants a bespoke fork (the answer is configuration or no).

Prioritize: revenue proof before platform ambition; the second product only
after the first one pays; a human engineer who *owns* the system before the
customer count makes a bad week unsurvivable; and the hardening items whose
triggers have fired.

And keep writing things down. The habit that saved this company was never
technical — it was that every decision, migration, and dead end got recorded
where the next contributor would find it.

---

## 10. The Things That Should Never Change

If the stack changes, the products change, the team changes — these survive:

1. **Customer-owned storage.** We point; we do not hold.
2. **The guest surface stays simple.** No accounts, no friction, ever, on the
   public side.
3. **Server-authoritative truth.** The anonymous surface is never trusted.
4. **No silent side effects.** Every action leaves a visible record.
5. **Least privilege, always.** And find the feature inside the constraint.
6. **Intake survives everything.** Downstream can fail; the upload cannot.
7. **Honest guarantees.** At-least-once plus idempotency; never claim more.
8. **Evolution over replacement.** Boundaries are proven by second consumers,
   not by architecture documents.
9. **Reversibility.** Every change knows its own undo before it ships.
10. **The repository is the memory.** Whoever you are, whenever you are:
    leave it better documented than you found it, because the next
    contributor — human or machine — will trust what you wrote.

*— end of playbook —*
