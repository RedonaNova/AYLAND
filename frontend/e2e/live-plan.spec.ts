import { expect, type Page, type Route, test } from "@playwright/test";
import { at, hanoiToday, seedBookings, seedOffers, seedTrip } from "../src/lib/mock/seed";
import type { AgentEvent, Trip } from "../src/lib/types";

// M3 in live mode against a scripted orchestrator: a re-plan arrives as plan.updated on the trip event poll and
// refreshes the timeline and budget; a proposal shows its approval card; declining calls the reject endpoint.

const AGENT_TIMEOUT = { timeout: 15_000 };
const today = hanoiToday();
const ok = { ok: true };
const puppet = seedOffers(today).find((o) => o._id === "off_puppet")!;

const fulfill = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

function replanned(): Trip {
  const trip = seedTrip(today);
  for (const item of trip.days[2].items) if (item.item_id === "d3-4" || item.item_id === "d3-5") item.status = "cancelled";
  return { ...trip, version: trip.version + 1 };
}

async function scriptedBackend(page: Page, turn: AgentEvent[]) {
  const state = { trip: seedTrip(today), pending: [] as AgentEvent[], rejected: [] as string[] };
  await page.route("**/api/health", (route) =>
    fulfill(route, { mongodb: ok, claude_cli: ok, oyu: ok, mcp_travel_data: ok, mcp_merchant: ok, a2a_booking: ok, a2a_interpreter: ok, demo_mode: true }),
  );
  await page.route("**/api/trips/trip_hanoi_demo", (route) =>
    fulfill(route, { trip: state.trip, bookings: seedBookings(today), weather: { condition: "rain", temp_c: 26, precip_prob: 90, until: "18:00", scenario: true }, now: at(today, "10:30") }),
  );
  await page.route("**/api/trips/trip_hanoi_demo/events/poll**", async (route) => {
    const events = state.pending.splice(0);
    if (!events.length) await new Promise((resolve) => setTimeout(resolve, 200));
    await fulfill(route, { events, cursor: "boot:1", reset: false });
  });
  await page.route("**/api/chat/runs", (route) => fulfill(route, { run_id: "run_p" }));
  await page.route("**/api/chat/runs/run_p/events**", async (route) => {
    // The backend publishes plan.updated on the trip stream as the tool writes the new version.
    if (turn.some((e) => e.type === "tool.end" && e.data.name === "update_trip_plan")) {
      state.trip = replanned();
      state.pending.push({ type: "plan.updated", data: { trip_id: "trip_hanoi_demo", version: state.trip.version, changed_item_ids: ["d3-4", "d3-5"] } });
    }
    await fulfill(route, { events: turn, cursor: turn.length, done: true });
  });
  await page.route("**/api/proposals/*/reject", async (route) => {
    state.rejected.push(route.request().url());
    await fulfill(route, { status: "rejected" });
  });
  return state;
}

async function goLive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByText("live API")).toBeVisible();
}

const tool = (name: string, summary: string): AgentEvent[] => [
  { type: "tool.start", data: { run_id: "run_p", call_id: name, name, input: {} } },
  { type: "tool.end", data: { run_id: "run_p", call_id: name, name, ok: true, summary, ms: 300 } },
];

test("a live re-plan refreshes the timeline and the budget", async ({ page }) => {
  await scriptedBackend(page, [
    ...tool("update_trip_plan", "v8 → v9 · 2 өөрчлөлт"),
    { type: "message.delta", data: { text: "Цикло болон алхалтыг цуцаллаа, буцаах боломжтой." } },
    { type: "message.done", data: { message_id: "run_p" } },
  ]);
  await goLive(page);
  await expect(page.getByText("$100").filter({ visible: true }).first()).toBeVisible();

  const input = page.locator("#composer-input");
  await input.fill("Гадаа хөтөлбөрүүдийг цуцлаарай");
  await input.press("Enter");
  await expect(page.getByText("Цикло болон алхалтыг цуцаллаа", { exact: false })).toBeVisible(AGENT_TIMEOUT);
  // The finished turn folds its trace into a summary; opening it shows the plan step.
  await page.getByRole("button", { name: /1 алхам/ }).click();
  await expect(page.getByText("Хөтөлбөр шинэчлэх")).toBeVisible();
  // $40 freed by the cancelled cyclo tour: the meter and the header follow the new version.
  await expect(page.getByText("$140").filter({ visible: true }).first()).toBeVisible(AGENT_TIMEOUT);
});

test("a live proposal shows its approval card, and declining it reaches the backend", async ({ page }) => {
  const proposal = {
    _id: "prp_live",
    trip_id: "trip_hanoi_demo",
    offer_id: puppet._id,
    slot_start: at(today, "15:00"),
    party_size: 4,
    total: { amount: 32, currency: "USD" as const, per: "group" as const },
    status: "proposed" as const,
    created_at: at(today, "10:30"),
  };
  const state = await scriptedBackend(page, [
    ...tool("propose_booking", "Усан хүүхэлдэйн театр 15:00 · $32 · зөвшөөрөл хүлээж байна"),
    { type: "proposal.created", data: { proposal, offer: puppet } },
    { type: "message.delta", data: { text: "Захиалгын карт бэлэн, зөвшөөрнө үү." } },
    { type: "message.done", data: { message_id: "run_p" } },
  ]);
  await goLive(page);

  const input = page.locator("#composer-input");
  await input.fill("Усан хүүхэлдэйн театрыг захиалаач");
  await input.press("Enter");
  await expect(page.getByText("Таны зөвшөөрөл хэрэгтэй")).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByRole("heading", { name: "Усан хүүхэлдэйн театр" })).toBeVisible(); // the offer came with the event
  await page.getByRole("button", { name: "Татгалзах" }).click();
  await expect(page.getByText("Татгалзсан", { exact: true })).toBeVisible();
  expect(state.rejected).toHaveLength(1);
  expect(state.rejected[0]).toContain("/api/proposals/prp_live/reject");
});
