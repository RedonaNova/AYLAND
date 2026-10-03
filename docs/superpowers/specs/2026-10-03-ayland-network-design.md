# AYLAND Network: design

**Status:** approved in brainstorming on 2026-10-03 (revised the same day to work in both directions); implementation plan next.
**Companion spec:** [welcome flow and traveler memory](2026-10-03-welcome-onboarding-design.md) (approved, unchanged by this one).
**Owners:** A (agents, MCP, booking), B (seed data, OyuLLM, MongoDB), C (Network page, interpreter mode, Vercel); HANDBOOK §9.

## Why

Judges will ask why anyone should use AYLAND instead of ChatGPT, Claude or OpenAI's new always-on dots. A proactive agent that remembers you is no longer unique. What a general agent cannot have is a network of local businesses that answer as agents, in both directions: businesses abroad where Mongolians travel, and Mongolian businesses (ger camps, herder stays, drivers, guides) that no general AI can book today, many run by people who speak only Mongolian.

**One-liner:** AYLAND is a travel agent network that works both ways: Mongolians abroad get a companion in their own language that books with local businesses' agents, and Mongolia's local businesses become bookable by every traveler and every AI.

## Users

| User | Channel | What is unique |
|---|---|---|
| Mongolian traveler abroad (Hanoi first) | The AYLAND app in Mongolian (today's product, plus the welcome flow) | Mongolian voice, memory, trip awareness, consent before every booking; bookings go agent-to-agent with the merchant's own agent |
| Mongolian traveler at home | The same app | Search Mongolian businesses in the network for a trip inside Mongolia |
| Foreign traveler in Mongolia | Their own AI (Claude, ChatGPT, dots, any MCP or A2A client) connected to AYLAND Network; the AYLAND interpreter in English ⇄ Mongolian | Mongolian businesses no general AI can find or book; Mongolian speech for talking to locals |

Mongolian hosts are **not** users in this change. Hosts joining and confirming by voice, and more countries, are the next steps (pitch: "what's next").

## Decisions

| Question | Decision |
|---|---|
| Supply | Abroad: the 28 seeded Hanoi merchants. Mongolia: 5 new fictional demo businesses. No real business names; all marked `demo: true`. |
| Data | Reuse `merchants` and `offers` (with their time slots) for both directions; no parallel collections for the catalog. |
| Who confirms a booking | The business's agent, within its rules (capacity, dates). Sandbox: no payment; every confirmation says "demo booking". |
| Public entry points | MCP server `ayland-network` and A2A agents, mounted in the API under `/network`, reached through Vercel at `https://<vercel-app>/network/...` |
| Booking safety | Two steps: `get_quote` (15-minute quote with the total), then `book(quote_id)`. Booking a quote twice returns the same code. In the app, the traveler's consent card comes first. |
| Currency | USD abroad, ₮ (MNT) in Mongolia; each total is given in its own currency, plus a rough USD figure for ₮ from a fixed setting, labelled approximate. |
| OyuLLM's job (D1) | The welcome-flow summary (companion spec), and for each network booking in Mongolia the Mongolian note the traveler shows the host on arrival (`host_note_mn`); a template is the fallback when OyuLLM is off, capped (shared daily cap) or slower than 5 s. |

## Data (MongoDB)

**Catalog: extend the existing models** (`db/models.py`; Hanoi flows keep working because they filter by city):
- `Money.currency`: `"USD" | "MNT"`.
- `Merchant` gains `slug` (unique), `name_en`, `country` (`"VN"`, `"MN"`), `region_mn`, `region_en`, `location`, `languages`, `rating`, `phone` (stored, never returned), `demo`.
- `Offer` gains `country`, category `"stay"`, `exclusive: bool = False` (one booking takes the whole slot, e.g. a car), `title_en` where missing, `cancellation_mn`, `cancellation_en`.
- **Slots describe both kinds of booking.** A timed activity or meal is one slot (as today). A night's stay is a check-in slot at 14:00 on that date whose `capacity_left` counts beds; *n* nights are *n* consecutive daily slots. A driver's day is one 08:00 slot with `exclusive: true`.
- **Seed:** `data/seed/hanoi.json` gains the new merchant fields; new `data/seed/mongolia.json` adds 5 businesses (two ger camps near Khustai, a herder family stay in Gorkhi-Terelj, a driver for UB ⇄ Terelj and Khustai, a city guide in Ulaanbaatar) and 6–8 offers in ₮ in both languages. Slots for the next 14 days are materialised relative to today, as the Hanoi slots are now.

**New collections for the network's own ledger:**
- `network_quotes`: `_id` (`q_…`), `offer_id`, `merchant_id`, `slot_starts[]`, `party_size`, `total` (Money), `requester` `{ channel, agent }`, `expires_at` (+15 min), `booking_code` once booked.
- `network_bookings`: `_id` (the code, `AYL-` + 4 characters), `quote_id` (unique), `offer_id`, `merchant_id`, `traveler_name`, `requester` `{ channel: "mcp" | "a2a" | "app", agent, language }`, `slot_starts[]`, `party_size`, `total`, `status: "confirmed" | "cancelled"`, `host_note_mn` and `note_via` (Mongolia only), `trip_id` (app bookings), `demo: true`, `created_at`.
- `network_events`: `at`, `channel` (`mcp`, `a2a`, `app`), `caller` (MCP client name when known, else "MCP client"; A2A: the calling agent's name when given, else "A2A client"; app: "AYLAND"), `action` (`search`, `listing`, `quote`, `book`, `status`, `card`), `summary_mn`, `summary_en`, `refs`.
- **Indexes:** `merchants.slug` unique; `offers` 2dsphere on `location` (exists) plus `{ country, category }`; `network_bookings.quote_id` unique; `network_events.at`.

## Architecture

New package `backend/ayland/network/`, mounted into the orchestrator app at `/network` (no new process or port):

| Part | Path | What it does |
|---|---|---|
| MCP server `ayland-network` | `/network/mcp` (Streamable HTTP, stateless, JSON responses) | Tools `search_listings`, `get_listing`, `get_quote`, `book`, `booking_status`, described in English. `get_quote`, `book` and `booking_status` call the business's agent over A2A. |
| Business agents | `/network/a2a/b/{slug}` (Agent Card at `/.well-known/agent-card.json`, JSON-RPC at `/a2a/jsonrpc`) | One agent per merchant, at home and abroad, built on `a2a_agents/base.Agent` from MongoDB by a small ASGI dispatcher that caches each agent's app. Skills: `describe`, `check_availability`, `quote`, `book`, `booking_status` (plus `ping`). |
| Directory agent | `/network/a2a/directory` | Skill `search` (same filters as `search_listings`); results carry each business's Agent Card URL. |
| Network API for our web app | `GET /api/network` (businesses, offers, counts), `GET /api/network/events?after=<iso>` | Feeds the Network page. |

The MCP server and AYLAND's Booking Agent reach business agents over real HTTP A2A (`network_internal_url`, default `http://localhost:8000/network`), so every hop is a genuine A2A call. Agent Cards advertise `network_public_url` (the Vercel address), so outside A2A clients get working URLs. Vercel gets a second rewrite next to `/api`: `/network/:path*` → `${AYLAND_API_ORIGIN}/network/:path*`.

## Flows

**A. Bat abroad: the Hanoi booking goes agent-to-agent** (this is how M4-D1 and M4-A1 get built).
1. As today: rain → options → `propose_booking` → the approval card.
2. Bat approves (`POST /api/proposals/{id}/approve`, M4-A1). The orchestrator asks AYLAND's Booking Agent `confirm_booking(proposal_id)` (M4-D1), which refuses unless the proposal is `approved` in MongoDB (the second consent check, §5.4).
3. The Booking Agent calls the merchant's own agent over A2A: `quote` for the proposal's slot and party, then `book`. The merchant's agent decrements the slot and returns its code.
4. The orchestrator writes the trip `booking` (with the network code), sets the plan item to `booked`, updates the budget, emits the events and a short Mongolian summary. The trace shows AYLAND → Booking Agent → the cooking school's agent.

**B. A foreign traveler's own AI books in Mongolia.**
1. The traveler adds `https://<vercel-app>/network/mcp` as an MCP connector in their AI.
2. `search_listings(query?, country?, region?, category?, start?, nights = 1, party_size = 1, max_total?, near?)` → up to 5 hits: business and offer names (English), country and region, rating, total in its currency (and approximate USD for ₮), open dates or times, `offer_id`, Agent Card URL. Ranking: filters first, then text match on titles, descriptions and tags, then rating.
3. `get_quote(offer_id, start, party_size, nights = 1)`: `start` is a date for stays and day-long offers, or a slot's local time for timed offers. A2A `quote` on that business's agent returns `{ quote_id, total, total_usd_approx, expires_at, cancellation }`.
4. The AI shows the price; on its user's yes, `book(quote_id, traveler_name)` → A2A `book` → the agent decrements every slot in **one atomic `update_one`** (each needs `capacity_left ≥ need`; `exclusive` sets it to 0), stores the booking, marks the quote used and returns `{ code, status, summary_en, host_note_mn }`.
5. `booking_status(code)` returns the booking.

A2A-native clients can skip MCP: directory `search`, then talk to the business agent's skills directly. Abroad listings (Hanoi) are searchable and bookable the same way.

**C. Network page (`/network` in the web app).** Mongolian UI: a header with counts (businesses, offers, bookings today) and two tabs, "Монголд" and "Гадаадад"; a "Connect your AI" box with the MCP URL, a copy button and two lines of how-to (Claude: Settings → Connectors → Add custom connector; Claude Code: `claude mcp add --transport http ayland-network <url>`); business cards (name, region, kind, price from, Agent Card link); a live feed of `network_events` polled every 2 s, newest first, covering outside AIs and AYLAND's own bookings ("Claude: 'ger stay with horses' хайлт", "AYLAND (Бат): Hanoi Cooking Centre, AYL-7K2Q"). Mock mode shows the seeded businesses from a static copy and notes that the feed needs Live mode. Added to the sidebar and bottom nav.

**D. Interpreter, foreign-traveler mode.** A switch on the interpreter page ("Mongolian traveler" / "Foreign traveler", remembered in localStorage). In foreign mode the sides swap: "me" speaks English (browser speech recognition) and hears English (browser speech); "them" speaks Mongolian (Anir) and hears Mongolian (tsuurAI); translation is the existing A2A `translate` (mn ⇄ en). The page's labels switch to English (a small `en` copy for this page only).

**E. Mongolian traveler at home.** Claude's tools in the app gain `search_listings` and `get_listing` from `ayland-network` (read-only; `get_quote` and `book` are not allowed in the app, so bookings keep the consent card). Prompt v3 adds one line: for plans inside Mongolia, search the network. Booking network offers in Mongolia from the app uses flow A once the trip model supports ₮ (not in this change).

## Safety

- Public endpoints: rate limit ~60 requests per minute per client IP (in-memory), body size limits, pydantic validation of every input.
- `phone` and other private fields never appear in any tool, skill or API output.
- No booking without a quote; quotes expire after 15 minutes; `book` is idempotent per quote. In the app, a booking also needs the approved proposal (two consent checks).
- Sandbox: no payment; every booking and confirmation is labelled as a demo; `/api/demo/reset` restores slot capacity and clears network quotes and bookings.
- No authentication on the public endpoints during the hackathon; listed as a next step.

## Failure cases

| Case | Result |
|---|---|
| Business agent does not answer within 5 s | Tool error: "The business's agent did not answer; try again." In the app: the approval card shows the error and the proposal stays approved for a retry. |
| Quote expired | Tool error: "Quote expired; call get_quote again." |
| No room for the party at that start | Empty result plus the nearest starts that fit |
| Two `book` calls race for the last place | One confirms; the other gets "no longer available" |
| Same quote booked twice | The same code again |
| Booking Agent asked to confirm a proposal that is not `approved` | Refused (`SkillError`); nothing is booked |
| The merchant's quote differs from the total Bat approved | Refused before `book`; the card says the price changed and asks for a new approval (consent covers the price) |
| Unknown offer, business or code | Tool error naming the id |
| MongoDB down | Tool error; the Network page shows its error state |
| OyuLLM off, capped, slow or malformed while writing the host note | The booking still confirms; `host_note_mn` comes from the template (`note_via: "template"`) |

## Testing

- **Backend (pytest, offline):** search filters (country, region, category, party, start, price); quote → book for a timed offer, a multi-night stay and an exclusive offer, through in-memory MCP and A2A; expired quote; atomic last-place race; idempotent book; private fields never returned; each business serves its own Agent Card with the public URL; directory search; events written for each action; seeds materialise 14 days of slots; rate limiter; host note from OyuLLM (stubbed) and the template fallback; Booking Agent refuses a non-approved proposal, refuses when the merchant's quote differs from the approved total, and books an approved one through the merchant's agent; Hanoi searches unchanged by the new Mongolian offers.
- **Frontend (Playwright, offline):** Network page renders businesses and new feed events from a scripted backend, with both tabs; the interpreter's foreign mode swaps labels and directions (mock); the approval card's live approve shows the confirmation (scripted backend).
- **Live (paid, only with the team's OK):** one run where Claude, connected to the public MCP URL, searches, quotes and books in Mongolia; one live Hanoi approval that books through the merchant's agent; the Network page shows each step.

## Order of work

1. Network core (backend): model extensions, both seeds, business agents and directory, MCP server, quote and book, events, reset.
2. Hanoi booking through the merchant's agent: Booking Agent skills (M4-D1) and the approve endpoint (M4-A1), wired to the approval card.
3. Network page and the Vercel `/network` rewrite.
4. Interpreter foreign-traveler mode.
5. Network search for Claude in the app.

The welcome flow (companion spec) is independent and can be built in parallel by C.

## HANDBOOK updates

§2–§3: the one-liner, the user groups and the new demo acts (Bat's Hanoi booking agent-to-agent; a tourist's own AI books in Mongolia; the interpreter in foreign mode; next steps). §5: the `network` component. §8: the model extensions, the three new collections, the `ayland-network` tools, the business and directory agents, the Booking Agent skills, the approve endpoint and the network API. §9: owners per the split above; D1 settled. §10: a network milestone; M4-D1 and M4-A1 rewritten to go through the merchant's agent. §12: connecting an AI to the network.

## Not in this change

Hosts joining and confirming by voice; countries beyond Vietnam and Mongolia; payments; authentication for the public endpoints; vector search over listings; booking ₮ offers from inside the app; languages other than Mongolian and English.
