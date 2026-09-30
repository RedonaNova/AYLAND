// Browser-side stand-in for the FastAPI orchestrator. It keeps its own trip state and emits
// the same SSE events (§8.4) the real one will, with realistic timing, so the UI is built
// against the contract rather than against this mock.

import type { AylandApi } from "../api";
import { addMinutes, countMn, dayBudget, dayOf, groupAmount, hhmm, minutesOf, usd } from "../format";
import type { A2AStatus, AgentEvent, Booking, Offer, PlanItem, Proposal, TripOption, TripView, Weather } from "../types";
import { lookup } from "./phrasebook";
import {
  DEMO_NOW,
  HOTEL,
  OPTION_REASONS,
  PLACES,
  TOP_OFFER_ORDER,
  TRAVEL,
  TRIP_ID,
  at,
  hanoiToday,
  seedBookings,
  seedOffers,
  seedTrip,
} from "./seed";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function confirmationCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `AYL-${Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")}`;
}

function freshState() {
  const today = hanoiToday();
  return {
    today,
    trip: seedTrip(today),
    bookings: seedBookings(today),
    offers: seedOffers(today),
    proposals: new Map<string, Proposal>(),
    weather: "clear" as "clear" | "rain",
    lastOptions: [] as TripOption[],
  };
}

type State = ReturnType<typeof freshState>;

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  ms: number;
  summary: string;
}

/** Emits every tool.start at once, then each tool.end as its call "finishes" (parallel tool use). */
async function* parallel(runId: string, calls: ToolCall[]): AsyncGenerator<AgentEvent> {
  const started = calls.map((call) => ({ ...call, call_id: newId("call") }));
  for (const c of started) {
    yield { type: "tool.start", data: { run_id: runId, call_id: c.call_id, name: c.name, input: c.input } };
  }
  let elapsed = 0;
  for (const c of [...started].sort((a, b) => a.ms - b.ms)) {
    await sleep(c.ms - elapsed);
    elapsed = c.ms;
    yield { type: "tool.end", data: { run_id: runId, call_id: c.call_id, name: c.name, ok: true, summary: c.summary, ms: c.ms } };
  }
}

async function* stream(text: string): AsyncGenerator<AgentEvent> {
  for (let i = 0; i < text.length; ) {
    const size = 2 + Math.floor(Math.random() * 5);
    yield { type: "message.delta", data: { text: text.slice(i, i + size) } };
    i += size;
    await sleep(14 + Math.random() * 20);
  }
}

const done = (): AgentEvent => ({ type: "message.done", data: { message_id: newId("msg") } });
const confirmCall = (status: A2AStatus): AgentEvent => ({
  type: "a2a.call",
  data: { agent: "booking-agent", skill: "confirm_booking", status },
});

type Intent =
  | { kind: "options" | "budget" | "plan" | "meals" | "route" | "thanks" | "fallback" }
  | { kind: "propose"; rank: number | null }
  | { kind: "confirm"; proposalId: string };

const OFFER_KEYWORDS: [RegExp, string][] = [
  [/хүүхэлдэй|театр|puppet/, "off_puppet"],
  [/хоол хийх|анги|cooking/, "off_cooking"],
  [/музей|кофе|museum/, "off_museum"],
];

function pickRank(text: string, options: TripOption[]): number | null {
  if (/эхн|нэгд|нэг дэх|\b1\b/.test(text)) return 1;
  if (/хоёр|\b2\b/.test(text)) return 2;
  if (/гурав|гурв|\b3\b/.test(text)) return 3;
  const match = OFFER_KEYWORDS.find(([re]) => re.test(text));
  return match ? (options.find((o) => o.offer._id === match[1])?.rank ?? null) : null;
}

function detectIntent(message: string, state: State): Intent {
  const text = message.toLowerCase();
  // At most one proposal is open (a new one expires the others); "yes" always means that one.
  const pending = [...state.proposals.values()].filter((p) => p.status === "proposed").at(-1);
  if (pending && /^(тийм|за[\s,.!]|за$|зөвшөөр)|баталгаажуул/.test(text)) return { kind: "confirm", proposalId: pending._id };
  if (state.lastOptions.length && /захиал|сонго|авъя|book/.test(text)) {
    return { kind: "propose", rank: pickRank(text, state.lastOptions) };
  }
  if (/бороо|юу хий|хувилбар|санал болго|өөрчл|rain/.test(text)) return { kind: "options" };
  if (/төсөв|мөнгө|үлдэгдэл|үлдсэн/.test(text)) return { kind: "budget" };
  if (/яаж оч|такси|тээвэр|зам /.test(text)) return { kind: "route" };
  if (/хоол/.test(text)) return { kind: "meals" };
  if (/хөтөлбөр|төлөвлөгөө/.test(text)) return { kind: "plan" };
  if (/баярлалаа|гайхалтай|thank/.test(text)) return { kind: "thanks" };
  return { kind: "fallback" };
}

export function createMockOrchestrator(): AylandApi {
  let state = freshState();
  // Bumped on reset. A run that started before a reset must not write into the fresh state.
  let epoch = 0;
  const listeners = new Set<(event: AgentEvent) => void>();
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Stops forwarding a run's events once the demo has been reset under it. */
  async function* scoped(run: AsyncGenerator<AgentEvent>): AsyncGenerator<AgentEvent> {
    const born = epoch;
    for await (const event of run) {
      if (born !== epoch) return;
      yield event;
    }
  }

  const todayPlan = () => dayOf(state.trip, state.today)!;
  const nowIso = () => at(state.today, DEMO_NOW);
  const hotelInput = { lon: HOTEL.location.coordinates[0], lat: HOTEL.location.coordinates[1] };
  const upcoming = () => todayPlan().items.filter((i) => i.status === "planned" && minutesOf(i.start) >= minutesOf(nowIso()));
  const rainAffected = () => upcoming().filter((i) => !i.indoor);

  function weatherNow(): Weather {
    return state.weather === "rain"
      ? { condition: "rain", temp_c: 26, precip_prob: 90, until: "18:00", scenario: true }
      : { condition: "clouds", temp_c: 29, precip_prob: 10, scenario: true };
  }

  function weatherSummary(w: Weather): string {
    return w.condition === "rain"
      ? `Бороо ${w.precip_prob}% · ${w.temp_c}°C · ${w.until} хүртэл`
      : `Үүлшинэ · ${w.temp_c}°C · бороо ${w.precip_prob}%`;
  }

  function buildOptions(): TripOption[] {
    return TOP_OFFER_ORDER.map((offerId, index) => {
      const offer = state.offers.find((o) => o._id === offerId)!;
      const slot = offer.slots.find((s) => minutesOf(s.start) >= 13 * 60)!;
      const travel = TRAVEL[offerId];
      return {
        rank: index + 1,
        offer,
        slot_start: slot.start,
        slot_end: at(state.today, addMinutes(hhmm(slot.start), offer.duration_min)),
        price_total: { amount: groupAmount(offer.price, state.trip.party_size), currency: "USD", per: "group" },
        travel: {
          mode: travel.mode,
          duration_min: travel.duration_min,
          cost: travel.cost ? { amount: travel.cost, currency: "USD", per: "group" } : undefined,
        },
        reason: OPTION_REASONS[offerId],
      };
    });
  }

  async function* optionsRun(runId: string): AsyncGenerator<AgentEvent> {
    const born = epoch;
    await sleep(700);
    const weather = weatherNow();
    const budget = dayBudget(state.trip, state.today);
    yield* parallel(runId, [
      { name: "get_trip", input: { trip_id: TRIP_ID }, ms: 260, summary: `3-р өдөр · ${upcoming().length} хөтөлбөр үлдсэн` },
      { name: "get_weather", input: { city: "Hanoi", hours_ahead: 8 }, ms: 760, summary: weatherSummary(weather) },
      { name: "get_budget_status", input: { trip_id: TRIP_ID }, ms: 340, summary: `Өнөөдөр ${usd(budget.remaining)} үлдсэн` },
    ]);
    await sleep(520);
    const indoor = state.offers.filter((o) => o.tags.includes("indoor") && o.price.amount <= 25);
    yield* parallel(runId, [
      {
        name: "search_offers",
        input: { city: "Hanoi", query: "дотор, бороотой өдөр", tags: ["indoor"], max_price_per_person: 25, party_size: 4, near: hotelInput, radius_m: 8000, time_window: "13:00–19:00" },
        ms: 1020,
        summary: `${indoor.length} санал олдлоо → шилдэг 3`,
      },
    ]);
    await sleep(380);
    const options = buildOptions();
    yield* parallel(
      runId,
      options.map((o, i) => ({
        name: "get_route",
        input: { from: "hotel", to: o.offer.title, mode: o.travel.mode },
        ms: 420 + i * 130,
        summary: `${o.travel.duration_min} мин ${o.travel.mode === "walk" ? "алхана" : "машинаар"}`,
      })),
    );
    if (born !== epoch) return;
    state.lastOptions = options;
    await sleep(420);

    const intro =
      weather.condition === "rain"
        ? `Ханойд одоо бороо орж байна (${weather.precip_prob}%, ${weather.temp_c}°C), ${weather.until} хүртэл үргэлжилнэ. Та дөрвийн өнөөдрийн **${usd(budget.remaining)}**-д багтах, бүгд дотор болох гурван хувилбар оллоо:`
        : `Одоогоор Ханойд бороо ороогүй байна (${weather.temp_c}°C). Гэхдээ та дөрвийн **${usd(budget.remaining)}**-д багтах, дотор болох гурван хувилбар байна:`;
    yield* stream(intro);
    yield { type: "options", data: { run_id: runId, options } };
    await sleep(350);
    yield* stream("\n\nГурвуулаа төсөвт багтана. Аль нэгийг нь сонговол би захиалгыг бэлдээд, **таны зөвшөөрлийг** авна.");
    yield done();
  }

  async function* proposeRun(runId: string, rank: number | null): AsyncGenerator<AgentEvent> {
    const born = epoch;
    await sleep(500);
    const option = state.lastOptions.find((o) => o.rank === rank);
    if (!option) {
      yield* stream("Аль хувилбарыг захиалах вэ? Эхний, хоёр дахь, гурав дахь гэж хэлээрэй.");
      yield done();
      return;
    }
    const slot = option.offer.slots.find((s) => s.start === option.slot_start)!;
    yield* parallel(runId, [
      {
        name: "check_availability",
        input: { offer_id: option.offer._id, date: state.today, party_size: state.trip.party_size },
        ms: 560,
        summary: `${hhmm(slot.start)} · ${slot.capacity_left} суудал сул`,
      },
    ]);
    const proposal: Proposal = {
      _id: newId("prp"),
      trip_id: TRIP_ID,
      offer_id: option.offer._id,
      slot_start: option.slot_start,
      party_size: state.trip.party_size,
      total: option.price_total,
      status: "proposed",
      created_at: nowIso(),
    };
    if (born !== epoch) return;
    // One open proposal at a time, so a later "yes" can never approve a card the user no longer sees.
    for (const open of state.proposals.values()) if (open.status === "proposed") open.status = "expired";
    state.proposals.set(proposal._id, proposal);
    yield* parallel(runId, [
      {
        name: "propose_booking",
        input: { offer_id: proposal.offer_id, slot_start: proposal.slot_start, party_size: proposal.party_size },
        ms: 280,
        summary: `Санал үүслээ · зөвшөөрөл хүлээж байна`,
      },
    ]);
    yield* stream(
      `Мэдлээ. Захиалгыг бэлдлээ: **${option.offer.title_mn}**, өнөөдөр ${hhmm(option.slot_start)} цагт, ${proposal.party_size} хүн. Таны зөвшөөрөлгүйгээр би мөнгө зарцуулахгүй — доорх мэдээллийг шалгаад баталгаажуулна уу.`,
    );
    yield { type: "proposal.created", data: { proposal: structuredClone(proposal) } };
    yield done();
  }

  /** Re-plans today around a confirmed booking and returns what changed. */
  function replan(proposal: Proposal, booking: Booking, offer: Offer) {
    const day = todayPlan();
    const start = proposal.slot_start;
    const end = at(state.today, addMinutes(hhmm(start), offer.duration_min));
    const raining = state.weather === "rain";
    const cancelled: PlanItem[] = [];
    for (const item of day.items) {
      if (item.status !== "planned") continue;
      const overlaps = minutesOf(item.start) < minutesOf(end) && minutesOf(item.end) > minutesOf(start);
      const outdoorInRain = raining && !item.indoor && minutesOf(item.start) >= minutesOf(nowIso());
      if (overlaps || outdoorInRain) {
        item.status = "cancelled";
        cancelled.push(item);
      }
    }

    const venue = { name: offer.title, address: offer.address, location: offer.location };
    const travel = TRAVEL[offer._id];
    const added: PlanItem[] = [];
    if (travel?.mode === "drive") {
      const leave = addMinutes(hhmm(start), -(travel.duration_min + 10));
      added.push({
        item_id: newId("itm"),
        start: at(state.today, leave),
        end: at(state.today, addMinutes(leave, travel.duration_min)),
        kind: "transport",
        title: "Grab такси",
        place: { ...venue, name: `Буудал → ${offer.title}` },
        cost: { amount: travel.cost ?? 0, currency: "USD", per: "group" },
        indoor: true,
        status: "planned",
        source: "agent",
      });
    }
    added.push({
      item_id: newId("itm"),
      start,
      end,
      kind: "activity",
      title: offer.title_mn,
      place: venue,
      cost: offer.price,
      indoor: true,
      status: "booked",
      offer_id: offer._id,
      booking_id: booking._id,
      source: "agent",
    });
    const next = day.items
      .filter((i) => i.status === "planned" && minutesOf(i.start) >= minutesOf(end))
      .sort((a, b) => minutesOf(a.start) - minutesOf(b.start))[0];
    if (raining && (!next || minutesOf(next.start) - minutesOf(end) >= 90)) {
      const from = addMinutes(hhmm(end), 30);
      added.push({
        item_id: newId("itm"),
        start: at(state.today, from),
        end: at(state.today, addMinutes(from, 45)),
        kind: "meal",
        title: "Өндөгтэй кофе",
        place: PLACES.eggCoffee,
        cost: { amount: 2, currency: "USD", per: "person" },
        indoor: true,
        status: "planned",
        source: "agent",
      });
    }

    day.items = [...day.items, ...added].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    state.trip.version += 1;
    state.trip.updated_at = nowIso();
    state.trip.budget.spent += booking.total.amount;
    return { cancelled, added };
  }

  async function* approveRun(proposalId: string, method: "tap" | "voice"): AsyncGenerator<AgentEvent> {
    const proposal = state.proposals.get(proposalId);
    // Consent gate: only a still-open proposal can be approved, and only once (no double booking).
    if (!proposal || proposal.status !== "proposed") {
      yield { type: "error", data: { message: "Энэ саналыг аль хэдийн шийдвэрлэсэн байна." } };
      return;
    }
    proposal.status = "approved";
    const born = epoch;
    const offer = state.offers.find((o) => o._id === proposal.offer_id)!;
    const runId = newId("run");

    yield confirmCall("submitted");
    await sleep(320);
    yield confirmCall("working");
    await sleep(1150);
    if (born !== epoch) return;
    const booking: Booking = {
      _id: newId("bkg"),
      trip_id: TRIP_ID,
      proposal_id: proposal._id,
      offer_id: offer._id,
      status: "confirmed",
      confirmation_code: confirmationCode(),
      total: proposal.total,
      consent: { approved_at: nowIso(), method },
      created_at: nowIso(),
    };
    state.bookings.push(booking);
    const slot = offer.slots.find((s) => s.start === proposal.slot_start);
    if (slot) slot.capacity_left -= proposal.party_size;
    yield confirmCall("completed");
    yield { type: "booking.confirmed", data: { booking: structuredClone(booking) } };
    await sleep(300);
    if (born !== epoch) return;

    const fromVersion = state.trip.version;
    const { cancelled, added } = replan(proposal, booking, offer);
    const changes = [
      ...cancelled.map((i) => ({ op: "cancel", item_id: i.item_id })),
      ...added.map((i) => ({ op: "add", item_id: i.item_id })),
    ];
    yield* parallel(runId, [
      {
        name: "update_trip_plan",
        input: { trip_id: TRIP_ID, date: state.today, changes, reason: state.weather === "rain" ? "rain" : "booking" },
        ms: 440,
        summary: `v${fromVersion} → v${state.trip.version} · ${changes.length} өөрчлөлт`,
      },
    ]);
    yield {
      type: "plan.updated",
      data: { trip_id: TRIP_ID, version: state.trip.version, changed_item_ids: changes.map((c) => c.item_id) },
    };
    await sleep(300);
    yield* stream(approvalSummary(booking, offer, proposal, cancelled, added));
    yield done();
  }

  function approvalSummary(booking: Booking, offer: Offer, proposal: Proposal, cancelled: PlanItem[], added: PlanItem[]): string {
    const lines = [`Захиалга баталгаажлаа! Баталгаажуулах код: **${booking.confirmation_code}**.`, "", "Өнөөдрийн хөтөлбөрийг шинэчиллээ:"];
    if (cancelled.length) {
      const why = state.weather === "rain" ? "бороонд өртөх " : "давхцсан ";
      lines.push(`• ${why}${countMn(cancelled.length)} хөтөлбөрийг (${cancelled.map((i) => i.title).join(", ")}) цуцаллаа`);
    }
    lines.push(`• ${hhmm(proposal.slot_start)} цагт ${offer.title_mn} нэмэгдлээ`);
    const taxi = added.find((i) => i.kind === "transport");
    if (taxi) lines.push(`• ${hhmm(taxi.start)} цагт Grab такси (${usd(taxi.cost.amount)})`);
    const coffee = added.find((i) => i.kind === "meal");
    if (coffee) lines.push(`• ${hhmm(coffee.start)} цагт өндөгтэй кофе — ${coffee.place.name}`);
    lines.push("", `Өнөөдрийн төсөвт **${usd(dayBudget(state.trip, state.today).remaining)}** үлдлээ.`);
    const leave = taxi ? hhmm(taxi.start) : addMinutes(hhmm(proposal.slot_start), -15);
    lines.push(`Дараагийн алхам: ${leave} цагт буудлаасаа гарвал цагтаа хүрнэ. Очоод **хэлмэрчийг** ашиглаарай.`);
    return lines.join("\n");
  }

  async function* budgetRun(runId: string): AsyncGenerator<AgentEvent> {
    await sleep(450);
    const b = dayBudget(state.trip, state.today);
    yield* parallel(runId, [{ name: "get_budget_status", input: { trip_id: TRIP_ID }, ms: 320, summary: `Үлдэгдэл ${usd(b.remaining)}` }]);
    yield* stream(
      `Өнөөдрийн хязгаар ${usd(b.limit)}. Үлдэгдэл: **${usd(b.remaining)}**.\nЗарцуулсан ${usd(b.spent)} · захиалсан ${usd(b.booked)} · төлөвлөсөн ${usd(b.planned)}.\n\nБороотой өдрийн хувилбар хэрэгтэй бол хэлээрэй.`,
    );
    yield done();
  }

  async function* planRun(runId: string): AsyncGenerator<AgentEvent> {
    await sleep(450);
    const next = upcoming();
    yield* parallel(runId, [{ name: "get_trip", input: { trip_id: TRIP_ID }, ms: 280, summary: `${next.length} хөтөлбөр үлдсэн` }]);
    const lines = next.map((i) => `• ${hhmm(i.start)} ${i.title}${i.indoor ? "" : " (гадаа)"}`);
    const tail = state.weather === "rain" && rainAffected().length
      ? "\n\nБороо орж байгаа тул гадаа хөтөлбөрүүдийг өөрчлөх үү?"
      : "\n\nӨөрчлөх зүйл байвал хэлээрэй.";
    yield* stream(`Өнөөдрийн үлдсэн хөтөлбөр:\n${lines.join("\n")}${tail}`);
    yield done();
  }

  async function* mealsRun(runId: string): AsyncGenerator<AgentEvent> {
    await sleep(450);
    const meals = upcoming().filter((i) => i.kind === "meal");
    yield* parallel(runId, [{ name: "get_trip", input: { trip_id: TRIP_ID }, ms: 260, summary: `${meals.length} хоолны цаг` }]);
    const lines = meals.map((i) => `• ${hhmm(i.start)} ${i.title} — ${i.place.name} (${usd(groupAmount(i.cost, state.trip.party_size))})`);
    yield* stream(`Өнөөдрийн хоолны төлөвлөгөө:\n${lines.join("\n")}\n\nӨөр газар хайх уу?`);
    yield done();
  }

  async function* routeRun(runId: string): AsyncGenerator<AgentEvent> {
    await sleep(450);
    const next = upcoming().find((i) => i.kind !== "transport") ?? todayPlan().items.find((i) => i.status === "booked");
    if (!next) {
      yield* simpleReply("Өнөөдөр өөр очих газар төлөвлөөгүй байна.");
      return;
    }
    yield* parallel(runId, [
      { name: "get_route", input: { from: "hotel", to: next.place.name, mode: "walk" }, ms: 420, summary: "18 мин алхана" },
      { name: "get_route", input: { from: "hotel", to: next.place.name, mode: "drive" }, ms: 520, summary: "7 мин машинаар" },
    ]);
    yield* stream(
      `Дараагийнх: **${hhmm(next.start)} ${next.title}** (${next.place.name}).\n• Алхвал 18 минут\n• Grab такси 7 минут, ойролцоогоор $2\n\n${state.weather === "rain" ? "Бороо орж байгаа тул такси дуудахыг зөвлөе." : "Цаг агаар сайхан тул алхаж болно."}`,
    );
    yield done();
  }

  async function* simpleReply(text: string): AsyncGenerator<AgentEvent> {
    await sleep(500);
    yield* stream(text);
    yield done();
  }

  function emit(event: AgentEvent) {
    for (const listener of listeners) listener(event);
  }

  /** Picks the run for a chat message (the real orchestrator lets Claude decide). */
  function route(message: string): AsyncGenerator<AgentEvent> {
    const runId = newId("run");
    const intent = detectIntent(message, state);
    switch (intent.kind) {
      case "options":
        return optionsRun(runId);
      case "propose":
        return proposeRun(runId, intent.rank);
      case "confirm":
        return approveRun(intent.proposalId, "voice");
      case "budget":
        return budgetRun(runId);
      case "plan":
        return planRun(runId);
      case "meals":
        return mealsRun(runId);
      case "route":
        return routeRun(runId);
      case "thanks":
        return simpleReply(
          state.bookings.some((b) => state.proposals.has(b.proposal_id))
            ? "Зүгээр ээ! Сайхан цагийг өнгөрүүлээрэй. Очоод хэлмэрч хэрэгтэй бол би энд байна."
            : "Зүгээр ээ! Өөр юугаар туслах вэ?",
        );
      default:
        return simpleReply(
          "Ойлголоо. Энэ демо хувилбарт би өнөөдрийн хөтөлбөр, төсөв, бороотой өдрийн хувилбар, захиалга дээр тусалж чадна. Жишээ нь: «Бороо орчихлоо, өнөөдөр 100$ дотор юу хийж болох вэ?»",
        );
    }
  }

  return {
    async getTrip(): Promise<TripView> {
      return structuredClone({
        trip: state.trip,
        bookings: state.bookings,
        weather: weatherNow(),
        now: nowIso(),
      });
    },

    chat({ message }) {
      return scoped(route(message));
    },

    approveProposal(proposalId, method) {
      return scoped(approveRun(proposalId, method));
    },

    async rejectProposal(proposalId) {
      // Transition first (like approve), so no approval can slip in while this call is in flight.
      const proposal = state.proposals.get(proposalId);
      if (proposal?.status === "proposed") proposal.status = "rejected";
      await sleep(250);
    },

    async interpret({ text, source_lang, target_lang }) {
      await sleep(650 + Math.random() * 300);
      const phrase = lookup(text, source_lang);
      if (phrase) return { text: phrase[target_lang], pronunciation_hint: target_lang === "vi" ? phrase.hint : undefined };
      return {
        text: target_lang === "vi" ? "(Bản demo: câu này chưa có bản dịch)" : "(Демо: энэ өгүүлбэрийн орчуулга бэлэн биш)",
      };
    },

    tripEvents(_tripId, onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },

    async demoReset() {
      clearTimeout(nudgeTimer);
      epoch += 1;
      state = freshState();
      emit({ type: "plan.updated", data: { trip_id: TRIP_ID, version: state.trip.version, changed_item_ids: [] } });
    },

    async demoScenario(weather) {
      clearTimeout(nudgeTimer);
      state.weather = weather;
      if (weather !== "rain") return;
      nudgeTimer = setTimeout(() => {
        const affected = rainAffected();
        if (!affected.length) return;
        emit({
          type: "nudge",
          data: {
            text: `Бороо орж эхэллээ. Өнөөдрийн ${countMn(affected.length)} гадаа хөтөлбөрт нөлөөлөх тул өөрчлөх үү?`,
            detail: affected.map((i) => `${hhmm(i.start)} ${i.title}`).join(" · "),
            actions: [
              { label: "Тийм, хувилбар санал болго", kind: "send", message: "Бороо орчихлоо, өнөөдөр 100$ дотор юу хийж болох вэ?" },
              { label: "Одоохондоо хэвээр", kind: "dismiss" },
            ],
          },
        });
      }, 1400);
    },
  };
}
