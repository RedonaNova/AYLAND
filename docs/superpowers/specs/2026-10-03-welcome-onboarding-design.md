# Welcome flow and traveler memory: design

**Status:** approved in brainstorming on 2026-10-03; implementation plan next.
**Owners:** spans workstreams A (agent), B (memories, OyuLLM) and C (frontend); see HANDBOOK §9.

## Why

A new visitor of the public link should meet AYLAND the way a traveler meets a good guide: a few questions, then advice that fits them. The answers become long-term memory in MongoDB, which the agent uses for every recommendation afterwards. It is also the visible proof of the "MongoDB remembers" line in the pitch, and it gives OyuLLM, a required technology, a real job (decision D1).

## Decisions

| Question | Decision |
|---|---|
| Who sees it | Public-link visitors, once per browser. The stage demo skips it (it opens mid-trip on day 3); the demo controls can replay it. |
| Where answers live | MongoDB (`users` + `memories`) under an anonymous visitor id, whenever the backend answers (also in Mock mode), plus a copy in the browser. |
| How the agent gets them | Injected into every chat turn as a short Mongolian block; a `remember` tool saves new facts learned in chat. |
| Look | Direction B, "traveler portrait": questions on the left, a portrait card that fills in live on the right. Not a Mindtrip copy. |
| Questions | Seven steps (below), every one skippable. |
| Summary and starter suggestions | OyuLLM writes them (one call per completed flow, capped); frontend templates are the fallback. |

## The flow

Full-screen overlay above the app, mounted by `AppShell` when the browser has no finished or skipped flow. The X skips the whole flow. Each step: a heading that streams in (about 35 characters a second; instant with reduced motion), a one-line reason, then the answers fade in. Bottom: seven progress segments, a back link with the step name, and **Дараах** (Enter also advances). Answers land on the portrait card at once; the newest row glows with "шинэ".

| # | Heading | Reason line | Answers → field |
|---|---|---|---|
| 1 | Сайн байна уу! Би AYLAND. Таныг хэн гэдэг вэ? | Цаашид нэрээр тань хандана. | text, ≤ 40 chars → `name` |
| 2 | Ихэвчлэн хэнтэй аялдаг вэ? | Хэдэн хүнд тохирох газар, ширээ, тасалбар хайхыг мэдэхэд хэрэгтэй. | Ганцаараа, Хосоороо, Гэр бүлээрээ, Найзуудтайгаа → `party`; "Хэдүүлээ вэ?" stepper 1–12 → `party_size` (hidden for solo/couple); "Хүүхэдтэй" toggle → `kids` (family, friends) |
| 3 | Аяллын төсөв тань ямар вэ? | Үнийн хувьд тохирохыг нь түрүүлж санал болгоно. | Хэмнэлттэй, Дунд зэрэг, Тансаг → `budget`; "Юунд илүү зарцуулахад бэлэн бэ?" Байр, Хоол, Үзвэр ба туршлага, Дэлгүүр → `splurge[]` |
| 4 | Аяллын хэмнэл тань ямар вэ? | Нэг өдөрт хэдэн газар төлөвлөхөө үүгээр тааруулна. | tiles: Тайван (өдөрт 2–3 газар, амралт ихтэй), Тэнцвэртэй (өдөрт 3–4 газар), Идэвхтэй (аль болох ихийг үзнэ) → `pace` = relaxed, normal, packed |
| 5 | Хоолны хувьд юуг анхаарах вэ? | Ресторан санал болгохдоо үүнийг заавал баримтална. | Халал, Цагаан хоолтон, Далайн хоол идэхгүй, Халуун ногоо бага, Сүүн бүтээгдэхүүнгүй → `diet[]`; Хязгаарлалтгүй clears them; "Гадаадад монгол хоол санадаг уу?" Тийм, Үгүй → `misses_mongolian_food` |
| 6 | Аялахдаа юунд хамгийн их дуртай вэ? | Хэдийг ч сонгож болно. Санал болгохдоо эдгээрийг түрүүлж бодно. | Түүх ба соёл, Хоол амтлах, Байгаль ба гадаа, Урлаг ба музей, Дэлгүүр, Шөнийн амьдрал, Гэрэл зураг, Спа ба амралт, Хүүхдэд ээлтэй → `interests[]` |
| 7 | Сүүлийн хоёр асуулт | Орон нутгийнхантай ярихад орчуулагчийг хэзээ санал болгохоо мэднэ. | "Англиар хэр ярьдаг вэ?" Чөлөөтэй, Бага зэрэг, Огт үгүй → `english`; "Өөр юу мэдвэл зүгээр вэ?" textarea ≤ 500 chars, placeholder "Жишээ нь: ээж маань хол алхаж чаддаггүй" → `notes` |
| ✓ | Бэлэн боллоо, {name}! | the summary (OyuLLM or template), streamed | **Эхлэх** closes the overlay; "OyuLLM бичсэн" credit when OyuLLM wrote it |

**Portrait card.** Title "Аялагчийн хөрөг" with the name below it (no genitive suffix: Mongolian names inflect irregularly). Rows: Хамт аялагч, Төсөв, Хэмнэл, Хоол, Сонирхол, Англи хэл, Тэмдэглэл; unanswered rows are dashed placeholders; a counter shows answered topics out of 7. Desktop: sticky right column. Phone: a pill at the top ("Аялагчийн хөрөг · 5") that opens the card as a bottom sheet.

**After the flow.** The empty chat (`Welcome`) greets "Сайн байна уу, {name}! Хаанаас эхлэх вэ?" with the three starter suggestions as chips plus "Өөр зүйл" (focuses the composer), above today's existing cards. Without a finished flow, `Welcome` stays as it is today (Bat).

**Copy rules.** All text lives in `frontend/src/i18n/mn.ts` (section `onboarding`) and, for the agent, in `backend/ayland/orchestrator/prompts/`. No name given → "Аялагч".

## Data

**Browser** (`frontend/src/lib/profile.ts`, read through `useSyncExternalStore` like `lib/mode.ts`; every storage access in try/catch):
- `ayland.visitor`: `v_` + `crypto.randomUUID()`, created on first need.
- `ayland.profile`: `{ version: 1, status: "done" | "skipped", answers, summary, suggestions, via, synced, completed_at }`.

**Contract `Answers`** (HANDBOOK §8; pydantic `Profile` in `db/models.py`, TS `Answers` in `lib/types.ts`; every field optional, `extra="forbid"`):

| Field | Type |
|---|---|
| `name` | string ≤ 40 |
| `party` | `"solo" \| "couple" \| "family" \| "friends"` |
| `party_size` | int 1–12 |
| `kids` | bool |
| `budget` | `"thrifty" \| "mid" \| "comfort"` |
| `splurge` | list of `"stay" \| "food" \| "experiences" \| "shopping"` |
| `pace` | `"relaxed" \| "normal" \| "packed"` (same values as `Preferences.pace`) |
| `diet` | list of `"halal" \| "vegetarian" \| "no_seafood" \| "mild_spice" \| "dairy_free"` (empty = no restrictions) |
| `misses_mongolian_food` | bool |
| `interests` | list of `"history" \| "food" \| "nature" \| "art" \| "shopping" \| "nightlife" \| "photo" \| "spa" \| "kids"` |
| `english` | `"fluent" \| "some" \| "none"` |
| `notes` | string ≤ 500 |

**MongoDB**
- `users`: upsert `{ _id: visitor_id, name, language: "mn", preferences, profile: Answers, updated_at }`. `preferences` (interests, food, pace, notes) is derived from the answers so older readers keep working. `User` gains `profile: Profile | None` and `updated_at`.
- `memories`: `Memory` gains `source: "onboarding" | "chat" | "seed"` (default `"chat"`). Saving a profile deletes that user's `source: "onboarding"` memories and inserts one `kind: "preference"` memory per answered topic, as one Mongolian sentence (e.g. "Гэр бүлээрээ, 4 хүн аялдаг, хүүхэдтэй.", "Хоолны хязгаарлалт: халал, далайн хоол идэхгүй.", "Англиар бага зэрэг ярьдаг; орон нутгийнхантай ярихад орчуулагч хэрэг болно."). Sentence templates live in `orchestrator/prompts/`.
- Index `memories { user_id: 1, created_at: -1 }` in `seed.ensure_indexes`.

## API

**`POST /api/profile`** body `{ visitor_id, answers }`
- `visitor_id` must match `^v_[0-9a-f-]{36}$`; anything else (including `user_bat`) → 422. No visitor can overwrite a seeded user.
- Saves `users` and `memories` as above, then asks OyuLLM for the summary and suggestions.
- Returns `{ summary: string | null, suggestions: string[], via: "oyu" | null }`. `summary: null` (and `suggestions: []`) when `ONBOARDING_LLM=off`, the daily cap is reached, OyuLLM fails, or it takes longer than 8 s. The client then uses its templates.
- MongoDB unavailable → 503; the client keeps the answers locally with `synced: false` and re-sends them once per later page load (with `summarize: false`, so no second OyuLLM call) until one is saved. *(Revised after the final review: a single retry fired right away in the same page load and then gave up.)*

**OyuLLM** (`llm/oyu.chat`): Mongolian instructions in `prompts/onboarding.md`. In: the answers. Out: JSON `{ "summary": "<2 sentences addressing {name}>", "suggestions": ["<≤ 7 words>", ×3] }` for the current destination (Hanoi). Parsed defensively; anything malformed counts as a failure. Settings: `onboarding_llm: "oyu" | "off"` (default `"oyu"`), `onboarding_llm_daily_cap: int` (default 200, counted in process memory per Hanoi day).

**Chat:** `ChatRequest` gains optional `user_id` (same pattern). The client sends it only when the flow is `done`. Without it the turn uses the trip's `owner_id` (Bat).

**Templates (frontend, `mn.ts`):** summary from party, pace, the top two interests and diet; suggestions picked from a small rule table (diet → a dinner place that fits; interests history → a calm historic walk; kids → a child-friendly museum; misses Mongolian food → a Mongolian restaurant nearby; fallback → today's plan in the rain).

## Agent

- `chat_turn` passes `user_id or trip.owner_id` to `agent.run`. Before the query, `memory.context(db, user_id)` renders:
  ```
  [Аялагчийн хөрөг: Сарнай]
  - Гэр бүлээрээ, 4 хүн аялдаг, хүүхэдтэй.
  - Хоолны хязгаарлалт: далайн хоол идэхгүй.
  - Англиар бага зэрэг ярьдаг.
  [Санах ой]
  - Ээж нь хол алхаж чаддаггүй.
  ```
  from the profile (or, for Bat, the seed `preferences`) and the latest 12 non-onboarding memories. It is prefixed to the message Claude receives; the stored `messages` row stays as typed. Empty profile and no memories → no block.
- **`remember`** (local tool): input `{ text: string ≤ 200, kind: "preference" | "fact" }`; inserts a `source: "chat"` memory for the turn's user (per-trip state `tools.turn_users`, like `turn_runs`); result "Санах ойд хадгаллаа". Added to `LOCAL` and `ALLOWED`; shows in the trace like other tools.
- **Prompt v3** (`prompts/system.md`): the block may start a message; diet is a hard rule; weigh pace, budget and interests and name the traveler in reasons; when English is weak, offer the interpreter for talking with locals; call `remember` for lasting preferences or facts the traveler states; never mention or quote the block.
- Known limit, unchanged: one Claude session per trip, shared by all visitors. The per-turn block names who is asking now.

## Mock mode

The mock orchestrator reads the browser profile: the greeting uses the name; starter suggestions come from the templates; option replies drop seafood offers and add a reason line when `diet` has `no_seafood`, and mention a matching interest by name. Nothing else changes.

## Demo controls

"Танилцуулгыг дахин үзэх" (replay the welcome) clears `ayland.profile` and keeps the visitor id, so a replay overwrites the same user and memories.

## Errors and edge cases

| Case | Behaviour |
|---|---|
| Backend down or Mock mode without a backend | Flow completes; template summary; `synced: false`; re-sent on each later page load until saved |
| X on the finished screen | Closes with the answers (they were already sent); hidden while the summary is being written |
| Enter after clicking an answer | Moves to the next step; the answer stays (Space toggles a focused answer) |
| OyuLLM off, capped, slow (> 8 s) or malformed | `summary: null` → templates; no "OyuLLM бичсэн" credit |
| Storage blocked (private window) | Flow shows every visit; nothing breaks |
| Skipped with X | `status: "skipped"`; nothing sent; chat behaves as today |
| Name empty | "Аялагч" everywhere |
| Re-submission (replay) | Same visitor id; onboarding memories replaced, chat memories kept |

## Testing

- **Backend (pytest, offline):** profile endpoint rejects bad ids and `user_bat`; saving writes `users` and replaces only onboarding memories; context block for a visitor, for Bat (seed preferences) and for an empty profile; `remember` writes under the turn's user; OyuLLM failure, timeout, malformed JSON and cap each give `summary: null`; `ChatRequest.user_id` validation.
- **Frontend (Playwright, offline):** new `e2e/onboarding.spec.ts`: first visit shows the flow; answers fill the card; finishing shows the name and suggestions in the chat (templates, backend mocked to fail); the X skips for good across reloads; demo-controls replay works; phone layout pill opens the card. Existing specs get an init script that marks the flow done, so they don't change.
- **Live check (paid, only with the team's OK):** one OyuLLM summary; one Claude turn with a "no seafood" profile that keeps seafood out of the options.

## HANDBOOK updates

§8.1 `users.profile`, `memories.source`, the new index; §8.2 `remember` (and `recall` stays a *Should* for vector search); §8.4 `POST /api/profile` and `user_id` on chat; §10 a new task for the welcome flow and M3-B3 marked partly covered; §9 D1: OyuLLM writes the onboarding summary and suggestions.

## Not in this change

Vector search and `recall` (M3-B3 remainder); editing the portrait later (e.g. from the trip page); identity across devices; per-visitor Claude sessions; deleting a visitor's data on request; voice answers in the flow.
