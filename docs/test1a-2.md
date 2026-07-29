# test1a-2 — the version with a pulse

Companion to [test1a.md](test1a.md). That document counted what's broken: 185 verified findings, every one true, and not one line of it made anybody want to build anything. This one is the opposite document. It's about what ZenoSource should *feel* like.

**Everything here is opinion, on purpose.** Where I state a fact I've cited it. Where I'm making a bet, I say so. Nothing proposed needs an ML pipeline, an inbound-email parser, a supplier portal, or a table you'd be nervous to migrate — the single most important thing I found is that **most of this is already in your database and you're just not drawing it.**

Method: four rival design directions developed independently against the real running app, plus competitive and aesthetic reconnaissance (real screenshots of SourceDay and Axya product UI, pixel-sampled), plus a voice pass over all 58 user-visible strings. Then three judges — a founder, a procurement manager, and a design lead shipping with one engineer — scored them blind on ambition, doctrine fit, buildability, demo power and durability. **All three picked the same spine.** The disagreements were about what to graft onto it, and they were productive.

> **Outcome (2026-07-28):** this document and [test1a.md](test1a.md) were merged into a single **[Phase 1b — The Ledger](todo.md#phase-1b--the-ledger-uxui-appsplatform)**. They were never two projects — the design spine's kill list and the audit's fix list are largely the same list. The plan there is ordered by dependency, not by severity or aesthetics. Read this document for the *why*; read Phase 1b for the *what and when*.

---

## The 30-second version

> **The spine is time.** One scalar — `now − openedAt` — drives the entire colour system. Fresh work is quiet steel-grey; work that's been sitting oxidizes. Nothing else in the product gets a hue. The list opens on what's rotting instead of what arrived last.
>
> **The headline is ownership.** Every screen answers *"You owe 3. They owe 11."* before it answers anything else, because that's the product's actual thesis and it is currently unanswerable anywhere in the app.
>
> **The supplier gets a receipt, not a form.** The most-distributed surface ZenoSource has is a screen seen by companies who will never pay you. Today it's a black button on grey.
>
> **And the purchase order becomes a real document** — with a number you can say out loud on a phone call, a total you can cite, and a print stylesheet. Neither competitor has one.

Cost: roughly six additive columns and one `orderBy`. Seriously.

---

## Six uncomfortable things

### 1. You shipped your schema as your information architecture

Here is the entire nav ([nav-links.ts](../apps/platform/src/app/dashboard/nav-links.ts:5)):

```
Dashboard · Purchase orders · RFQs · Price lists · Suppliers · Locations
```

Five of those six are Prisma models. The nav is `schema.prisma` with icons.

That would be fine for a system of record — but [product.md](product.md) opens by insisting this is **not** a system of record, it's process management software whose job is driving state to closure. The product's thesis is *verbs and clocks*. The interface is *nouns and tables*. The one surface that expresses the thesis — the action inbox — is one of seven equal items in a sidebar, landing on a screen that is 66% empty.

The competitors, to be fair, do the same thing. That's the opportunity.

### 2. There is no clock in a product whose entire thesis is lateness

Nothing in the app has age. A PO issued this morning and a PO a supplier has ignored for three weeks render identically — same card, same badge, same grey `7/28/2026`. The default sort on every list is **`Newest first`**, which is precisely backwards for a chase product: it buries the work that's rotting under the work that just arrived.

And here's the part that makes this the best-value item in the document:

```prisma
model ActionItem {
  openedAt   DateTime  @default(now())   // ← schema.prisma:457
  resolvedAt DateTime?
  ownerType  ActionItemOwnerType         // INTERNAL_USER | EXTERNAL_USER
}
```

**`openedAt` already exists. `ownerType` already exists.** Age, heat, dwell, whose-court, "how long has Titan been sitting on this" — all of it is computable today, on the current schema, with zero migrations. It's already the `orderBy` key in `listOpenActionItemsForInternalUser`. You are sorting by it and then not showing it.

`needByDate` is the same story: collected by the form, stored in Postgres, rendered on exactly zero screens.

### 3. Your most-distributed screen is a black button on a grey card

Every reminder email is a billboard delivered to a company that isn't your customer. Hundreds of supplier organizations will see `/a/{token}` and form their entire impression of ZenoSource from it. It currently doesn't name the buyer, doesn't show a PO number, doesn't show a date, and its RFQ variant reads **"Submit your quote"** above a button labelled **"Acknowledge"** that submits no quote.

And a correction to the positioning, from the recon: **SourceDay already markets this.** Their site carries a literal bullet reading `"No login", interactive emails`. The no-login link is not unclaimed territory. So the differentiator can't be *that it exists* — it has to be that ours is conspicuously, memorably better. Right now it's conspicuously worse than a Stripe receipt.

### 4. You have no brand — you have two defaults

| What renders | Where it came from |
|---|---|
| `#4F46E5` indigo — nav, buttons, focus rings, the "Z" | Tailwind's `indigo-600`, i.e. the colour you get for typing nothing |
| Arial | [`globals.css:25`](../apps/platform/src/app/globals.css:25) — `create-next-app` boilerplate that overrides the two Geist webfonts [`layout.tsx`](../apps/platform/src/app/layout.tsx) downloads on every page load and throws away |

`globals.css` is 26 lines: four colour tokens and a font-family that's actively fighting the fonts you're paying bandwidth for. There is no design system to reform here. **There's a blank page**, which is the best possible news for a brief that asks for boldness.

Meanwhile SourceDay's marketing site runs Mona Sans, JetBrains Mono eyebrows, and a vivid `#1BCF02` lime — and then their *product* screenshots appear to be an unthemed component library, with none of that brand present. Marketing and product are two different companies over there. That gap is takeable.

### 5. You lose head-to-head on your namesake interaction

SourceDay's proposed-change card renders an actual diff:

```
PO BG-78854
Date:      12/21/2023  →  01/10/2024      (old struck through, dark red)
Quantity:  12          →  14              (new value, dark green)
Cost:      $46.0000 ea →  $48.0000 ea
[ Accept or propose change ]
```

ZenoSource's equivalent shows **only the proposed values, never the current ones** ([finding in test1a.md](test1a.md)) — a buyer approves a change without being shown what changed. Supplier-driven change collaboration is the thing this product is *for*. This is the one screen where being second-best is fatal, and it's a layout problem, not a data problem: the old values are right there in the row.

### 6. The app has no opinion about what matters

24 purchase orders render as 24 identical 60px cards, each burning ~880px of horizontal emptiness to say three facts, sorted by arrival. No ranking, no emphasis, nothing bolded, nothing at the top because it deserves to be.

SourceDay solves this with saved views, a column picker, and `+ Suggested views`. Which is exactly the configurable-toolkit posture [product.md](product.md) rejects — and here's the sharpest competitive read in the whole exercise: **SourceDay needs saved views because their queue has no opinion.** An opinionated queue doesn't need a view builder. You already believe this. Now draw it.

---

## The direction: **NOTHING RUSTS**

*(Unanimous pick across all three judges — 41/43/41 out of 50, winning on doctrine fit, buildability and durability.)*

### The one rule

> **Saturation is reserved for time and ownership. Nothing else in the product gets a hue.**

That's it. That's the system. It's enforceable in code review with a grep, it survives greyscale and colour-blindness because age is *redundantly* encoded in stroke weight as well as hue, and it means every coloured pixel on screen is telling you something operational.

Which also means: **status badges lose their colours.** Today four badge tones carry nine PO statuses, so `closed` grey sits next to `fulfilled` green and the distinctions the state machine is built on collapse into mush. Every hue currently spent on state was stolen from time.

### The palette

Warm paper and oxidation. Steel doesn't rust on day one; it rusts when you leave it out.

| Token | Light | Role |
|---|---|---|
| `--paper` | `#FBFAF8` | page ground — warm off-white, never clinical |
| `--ink` | `#1A1817` | primary text |
| `--ink-2` | `#6B6560` | secondary, and the *only* grey allowed to carry meaning |
| `--rule` | `#E4E0D9` | hairlines — the app is drawn in rules, not cards |
| `age-0` | `#8B8D8F` | today — cool steel, deliberately unalarming |
| `age-1` | `#A98B6B` | 1–3 days — first tarnish |
| `age-2` | `#B9713F` | 4–7 days |
| `age-3` | `#A34C22` | 8–21 days |
| `age-4` | `#8E2C1E` | 22 days+ — oxblood |
| `--court-them` | `#1B4FB8` | cobalt: waiting on a supplier |
| `--verdigris` | `#3D7A6B` | the only positive: resolved, confirmed, clear |

Dark mode is the same ramp on `#151312`, and finally declares `color-scheme: dark` so native dropdowns stop rendering light inside dark fields.

**Type:** stop throwing away Geist. Geist Sans for the interface, **Geist Mono for every number that can be compared** — ages, quantities, money, document numbers — because tabular figures in a ledger are non-negotiable. A serif (Newsreader) appears in exactly two places: the supplier's screen and the printed document, where it's doing real work in front of strangers. It never appears inside the buyer's app, where you'd see it 200 times a week.

---

## Five signature moves

### 1. The board opens on what's rotting

Default sort becomes `WAITING` descending, everywhere. One `orderBy`. The procurement-manager judge called this out specifically: *"that's one `orderBy` and it is worth more to me than every animation in the other three combined."*

Each row gets a `WAITING` column in mono — `11d`, `3d`, `today` — coloured by the ramp, with stroke weight rising alongside it. The `Sort` dropdown is deleted. There is one right order and it isn't yours to choose. **That's what opinionated means.**

### 2. "You owe 3. They owe 11."

The dashboard leads with that sentence, second person, verb first, at display size. It is simultaneously the answer to Marcus's morning question, the homepage hero, and the demo. Below it the board splits: what you have to decide, and what you're waiting on — the latter being a view that **does not exist anywhere in the product today.**

### 3. The possession strip

A 28px bar under the PO title showing the order's whole life proportional to real elapsed time:

```
[1d draft][0.2d you issued][──────── 11d them ────────][2d you, open ]
```

Derived entirely from the `ActionItem` rows already written for that subject plus `PurchaseOrder.createdAt`. "Whose fault is it" is the question asked in every Monday production meeting, and this answers it in one second without anyone reading a timestamp.

### 4. The supplier gets a receipt — and the email gets an envelope

Two header fields, and the founder-judge rated it the highest leverage-to-effort item in the entire exercise:

```
From:     Acme Manufacturing via ZenoSource
Reply-To: dana@acme.test
Subject:  Acme Manufacturing needs a date on P-10418 — 500 EA SKU-1001
Preheader: Tap once to confirm. No account, no password.
```

Today that's `2 open items with Acme Manufacturing` over two byte-identical lines containing raw 64-character hex tokens. Suppliers ignore no-reply automation and answer humans.

After confirming, the supplier gets a **receipt written in the third person** — *"Sam Supplier confirmed 500 EA of SKU-1001 for delivery 14 Aug"* — because it gets forwarded to their own boss, and a record reads differently from a reply. Plus `Add to calendar (14 Aug)` as an `.ics` carrying the promise date. One route, and it's the most useful object anyone proposed: it puts your customer's need-by date into a shop foreman's calendar.

And a **speakable claim code** (`7QK2-M4RD`) replaces the 64-hex token anywhere a human reads it. The secret stays in the href. Today's link looks like malware and cannot be read down a phone.

### 5. `P-10418` — the number you can say out loud

One tenant-scoped sequence with a class letter: `P-10418` purchase orders, `Q-10422` RFQs, `L-10007` price schedules. Today a PO has no number at all and an RFQ has `RFQ-RLFD6H`, which is real, on screen right now, and unreadable over a phone.

Then a genuine `@media print` stylesheet: running masthead, parties block, totals under a double rule, `break-inside: avoid`, footer reading `P-10418 · Acme Manufacturing · page 1 of 2`. The receiving dock staples paper to boxes. **Neither competitor has a printable artifact in any form.**

---

## Screen by screen

| Screen | Today | Proposed |
|---|---|---|
| `/dashboard` | Three rows, 66% dead space, blank for a MEMBER | `You owe 3. They owe 11.` · your court / their court, hottest first · `Chase all 6` at the masthead |
| `/purchase-orders` | 24 identical cards, `Newest first`, ~880px dead per row | Ledger. `WAITING` desc. Columns: `№ · SUPPLIER · WHAT'S OWED · WAITING · VALUE · NEED BY`. `WHAT'S OWED` is a sentence: *"Precision Parts: acknowledge"* |
| `/purchase-orders/[id]` | Title = supplier name. No number, no total, no dates. Red **Cancel PO** is the loudest thing on screen | `P-10418` in mono. Possession strip. Line table with need-by, extended value, order total. Cancel demoted to quiet text |
| PO change proposal | Proposed values only — you can't see what changed | A real diff, old struck through → new, with **extended value as the last and heaviest row** (a 441% jump on a tiny line matters less than 4% on a big one) |
| `/purchase-orders/new` | 5 fixed cards, ~1500px tall, wipes on error | Rows not cards. Unit price pre-fills from the matching `PriceBreak` *for the quantity typed*, annotated `from schedule L-10007`; an override marks `off schedule +403%`. `Issue` disabled with the reason underneath instead of an error that eats 15 fields |
| `/rfqs` | `RFQ-RLFD6H`, no supplier, drafts indistinguishable from live | `Q-10422`. One 10px square per invitee, filled at *that invitee's* dwell, hollow once they respond. Two hollow + one solid = you know without opening it |
| `/rfqs/[id]` | Award fires instantly, no-bid renders as a bare em-dash | Per-supplier quote totals, low-bid emphasis, explicit `no bid`. Award states its consequence *including what doesn't happen*: **"This closes the RFQ for Northline and Titan. It does not create a PO — you'll raise that next."** |
| `/a/{token}` | Black button, grey card, doesn't name the buyer | Buyer's name first. `P-10418`. Need-by huge. One full-width button carrying the actual commitment: **`Confirm — 500 EA by 14 Aug`** |
| The reminder email | Plain text, byte-identical lines, raw hex | A designed artifact. It *is* the product for suppliers |

---

## The voice

The app already has a voice. It uses it about four times:

> *"This PO already changed — someone beat you to it."*
> *"Precision Parts Co. has no contact on file — add one before issuing this PO."*

Everything else was written by someone naming a variable. Five rules, each with a do/don't from a real string in this repo:

1. **Lead with the noun that's in trouble.** ✅ `"Precision Parts Co. has no contact on file…"` ❌ `"Supplier not found."`
2. **Report the world, not the software.** ✅ `"someone beat you to it"` ❌ `"This purchase order changed before your response could be recorded."` — same event, told from the database's point of view.
3. **Every verb is the consequence, not the persistence.** ✅ `"Issue to supplier"` — best button in the app. ❌ `"Save RFQ"` — this button emails three suppliers and opens three external action items. "Save" is a lie of omission.
4. **Say the awkward part out loud.** ❌ `"Only draft POs can be edited directly."` — *"directly"* implies an indirect route exists. It doesn't. That word is softening a rule you should be proud of. Try: *"This PO is already with the supplier. Issued POs change by agreement, not by edit."*
5. **Be funny only where the user isn't.** Never in an error, never on a supplier's phone. The empty inbox is the one place, and the joke is dry and one sentence: *"That's either very good news or you haven't started."*

Two vocabulary laws: the buyer always gets the trade word (*issue, chase, no-bid, need-by, lead time*). The supplier always gets the plain word (*confirm, can't do it, when you need it*). **Never make a supplier learn "acknowledge."**

And the login page gets the only sentence a login page is allowed: *"Nothing closed itself while you were away."*

**Name the chase "the chase."** SourceDay markets named AI agents ("Open Order Chaser", "PO Delivery Agent") over a mechanism they had to invent branding for. You have the actual mechanism and no name for it. `Chase all 6` · `Chased 9× · next 07:00` · `chased twice, no reply`. It's the trade word, it's honest, and it needs no capital letter.

---

## Four laws, so this survives a real tenant

Every direction was designed against a six-row screenshot. These are the rules that keep it honest at 400 rows — treat them as spec, not as risk mitigation:

1. **At-rest work gets no clock.** If no `ActionItem` is open, the `WAITING` cell is *blank* — not `age-0`. Most of a real tenant is at rest and that's correct. Without this law, a customer's first login is a wall of oxblood.
2. **The ramp applies only to items assigned to you.** Bounded by human capacity. The `WAITING` column on entity lists uses the muted variant.
3. **Rank by dwell × value, not dwell.** A 40-day-old $200 PO and a 4-day-old $80,000 PO currently render identically, and every buyer chases the second one first. The age ramp needs a money axis.
4. **A state that mints no `ActionItem` renders as suspiciously neutral.** This is the best sentence the exercise produced: the design turns *"a status nobody is being reminded to act on is a modeling bug"* into something you can **see**. Make it an engineering gate — audit every transition for an action item before this ships.

---

## What we deliberately don't build

[product.md](product.md) says configurability is a cost. Creative edge is not customization — it's stronger opinion and *fewer* choices. So, explicitly killed:

**Theme pickers · density toggles · saved views · column choosers · custom fields · a settings page · per-user preferences · the `Sort` dropdown · the `Apply` button · streaks, badges, confetti, and any productivity scoreboard about the user.**

Also cut, from the winning direction itself, on judges' advice: the empty-band scaffolding (it's a discipline scoreboard in a typographic costume), `BOARD CLEAR` at 44px (a ceremony for a state you hit twice a quarter), the card-flip animation (a returning 2013 idiom), and showing `chased 9×` **to the supplier** — that one disciplines the wrong side, and the supplier's goodwill is exactly what you need in November.

---

## What all four directions missed

The honest section. Every one of these came from judges attacking the proposals, and each is a real hole:

- **Money is never aggregated.** Nobody proposed *"$1.4M issued and unacknowledged"* or *"$310K sitting on a supplier over two weeks."* That's the sentence a CFO understands and the one that renews the contract.
- **Nobody designed the multi-line PO.** Every mockup shows a 1–3 line order. Real repeat orders run 12–40 lines with mixed statuses — line 3 acknowledged, line 7 change-proposed, line 11 late. `PurchaseOrderLine.status` is where the chase actually lives, and it's essentially undrawn.
- **There is nowhere to say anything.** All four treat `/a/{token}` as a state-machine terminal: accept, counter, reject. Real procurement is *"can you split it — 200 now, 300 in September?"* The moment the conversation doesn't fit three buttons, the buyer leaves for Outlook — and the drift this product exists to prevent restarts off-platform. This doesn't need a chat product. It needs **one note field on the action item, visible to both sides, that rides along in the chase email.**
- **Nothing survives the second person.** No handoff, no *"Casey's out — reassign her 14 items,"* no way to see she's carrying 22 while you carry 3. In a 200-person shop the common failure isn't that nobody chased the supplier — it's that an item was owned by someone who left, and the board looked fine to everyone else.
- **Nobody designed the manager.** Marcus owns no action items, so under every direction he signs in to an empty screen. The team board is the same query minus the `internalOwnerId` filter.
- **Nobody designed the failure of the premise.** Titan has been chased five times over 23 days. *Now what?* A chase with no terminal branch is the same modeling bug the doctrine warns about, one level up.
- **Nobody designed the Epicor-connected product.** [architecture.md](architecture.md)'s capability registry is the platform's core bet, and **a stale ERP connection is an open action owned by someone** — so by your own doctrine it belongs on the board.
- **Nobody proposed the number that renews the contract.** One honest figure from `ActionItem` history, no ML, no new tables: ***"84% of your suppliers responded without a second chase, up from 61%."*** Supplier non-adoption is the documented reason deployments in this category fail. That's the QBR slide, and it's the only report the doctrine has actually earned.

---

## The bet

The competition is two companies with modern marketing sites in front of component-library products. Neither draws time at all — SourceDay's urgency is a `Hot` sticker a human has to remember to apply, and Axya's `Late` pill renders one-day-late and forty-days-late identically.

So here's the sentence that isn't available to anyone else in this category, and it's true:

> **Nobody else draws the clock.**

You have `openedAt`. You have `ownerType`. You have `needByDate` sitting in Postgres, rendered nowhere. The most differentiated thing this product could do is already in the database, waiting for someone to give it a colour.

*Now build the ledger.*
