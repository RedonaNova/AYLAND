import { expect, type Page, test } from "@playwright/test";
import { at, hanoiToday, seedBookings, seedOffers, seedTrip } from "../src/lib/mock/seed";

// Live mode against a scripted orchestrator (page.route): the real live client, its long polls for chat turns
// and trip events, and the store, with no backend, Claude or Novelsoft (HANDBOOK §8.4, M2 exit check shape).

const AGENT_TIMEOUT = { timeout: 15_000 };
const today = hanoiToday();
const puppet = seedOffers(today).find((o) => o._id === "off_puppet")!;
const ok = { ok: true };

function json(body: unknown, delayMs = 0) {
  return async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };
}

const turn = [
  [
    { type: "tool.start", data: { run_id: "run_t", call_id: "c1", name: "get_weather", input: {} } },
    { type: "tool.end", data: { run_id: "run_t", call_id: "c1", name: "get_weather", ok: true, summary: "Бороо 90% · 26°C", ms: 410 } },
    { type: "tool.start", data: { run_id: "run_t", call_id: "c2", name: "search_offers", input: {} } },
    { type: "tool.end", data: { run_id: "run_t", call_id: "c2", name: "search_offers", ok: true, summary: "5 санал олдлоо", ms: 980 } },
    { type: "message.delta", data: { text: "Бороотой үдээс хойш хийх зүйл байна." } },
  ],
  [
    {
      type: "options",
      data: {
        run_id: "run_t",
        options: [
          {
            rank: 1,
            offer: puppet,
            slot_start: at(today, "15:00"),
            slot_end: at(today, "15:50"),
            price_total: { amount: 32, currency: "USD", per: "group" },
            travel: { mode: "walk", duration_min: 5 },
            reason: "Номин урлагт дуртай.",
          },
        ],
      },
    },
    { type: "message.delta", data: { text: "Аль нь хамгийн таалагдаж байна?" } },
    { type: "message.done", data: { message_id: "run_t" } },
  ],
];

test("live mode reads chat turns and trip events by long poll", async ({ page }) => {
  let nudgeQueued = false;
  const runPolls: number[] = [];

  await page.route("**/api/health", json({ mongodb: ok, claude_cli: ok, oyu: ok, mcp_travel_data: ok, mcp_merchant: ok, a2a_booking: ok, a2a_interpreter: ok, demo_mode: true }));
  await page.route("**/api/trips/trip_hanoi_demo", json({
    trip: seedTrip(today),
    bookings: seedBookings(today),
    weather: { condition: "clouds", temp_c: 29, precip_prob: 10, scenario: true },
    now: at(today, "10:30"),
  }));
  await page.route("**/api/trips/trip_hanoi_demo/events/poll**", async (route) => {
    const events = nudgeQueued
      ? [{ type: "nudge", data: { text: "Бороо орж эхэллээ. Өөрчлөх үү?", detail: "14:00 Цикло аялал", actions: [] } }]
      : [];
    nudgeQueued = false;
    await json({ events, cursor: "boot:1", reset: false }, events.length ? 0 : 250)(route);
  });
  await page.route("**/api/demo/scenario", async (route) => {
    nudgeQueued = true;
    await json({ weather: "rain" })(route);
  });
  await page.route("**/api/chat/runs", json({ run_id: "run_t" }));
  await page.route("**/api/chat/runs/run_t/events**", async (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get("cursor"));
    runPolls.push(cursor);
    const page = cursor === 0 ? turn[0] : turn[1];
    await json({ events: page, cursor: cursor + page.length, done: cursor !== 0 }, 150)(route);
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByText("live API")).toBeVisible();
  await expect(page.getByText("MongoDB · Claude · Novelsoft · MCP · A2A")).toBeVisible();

  // Act 1 by long poll: the nudge arrives without any streamed response.
  await page.getByRole("button", { name: "Бороо", exact: true }).click();
  await expect(page.getByText("Бороо орж эхэллээ", { exact: false })).toBeVisible(AGENT_TIMEOUT);

  // A chat turn in two poll pages: trace steps, the option card, the closing question.
  await page.getByRole("button", { name: "Бороотой өдөр юу хийх вэ?" }).click();
  await expect(page.getByText("Бороотой үдээс хойш хийх зүйл байна.")).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByRole("heading", { name: "Усан хүүхэлдэйн театр" })).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByText("Аль нь хамгийн таалагдаж байна?")).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByText("$32").first()).toBeVisible();
  expect(runPolls).toEqual([0, 5]);
});
