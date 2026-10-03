import { expect, type Page, test } from "@playwright/test";
import { at, hanoiToday, seedBookings, seedTrip } from "../src/lib/mock/seed";

// Voice in live mode against mocked routes (M5-C1): finished replies are read out with tsuurAI unless muted.
// No backend and no Novelsoft; /api/voice/speak answers with a short silent WAV.

const today = hanoiToday();
const ok = { ok: true };

function json(body: unknown) {
  return (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

/** 0.1 s of 16 kHz mono silence, the shape tsuurAI returns. */
function silentWav(): Buffer {
  const samples = 1600;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  return wav;
}

async function liveBackend(page: Page, replies: string[]) {
  let turn = 0;
  await page.route("**/api/health", json({ mongodb: ok, claude_cli: ok, oyu: ok, mcp_travel_data: ok, mcp_merchant: ok, a2a_booking: ok, a2a_interpreter: ok, demo_mode: true }));
  await page.route("**/api/trips/trip_hanoi_demo", json({
    trip: seedTrip(today),
    bookings: seedBookings(today),
    weather: { condition: "clouds", temp_c: 29, precip_prob: 10, scenario: true },
    now: at(today, "10:30"),
  }));
  await page.route("**/api/trips/trip_hanoi_demo/events/poll**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await json({ events: [], cursor: "boot:1", reset: false })(route);
  });
  await page.route("**/api/chat/runs", (route) => json({ run_id: `run_${++turn}` })(route));
  await page.route("**/api/chat/runs/*/events**", (route) => {
    const text = replies[Number(/run_(\d+)/.exec(route.request().url())![1]) - 1];
    return json({
      events: [
        { type: "message.delta", data: { text } },
        { type: "message.done", data: { message_id: "m" } },
      ],
      cursor: 2,
      done: true,
    })(route);
  });
}

test("live replies are read out with tsuurAI, and the mute toggle silences them", async ({ page }) => {
  const spoken: { text: string; lang: string }[] = [];
  await liveBackend(page, ["**Тийм.** Бороотой үед 🌧️ театр сайн.", "Төсөв 68$ үлдсэн."]);
  await page.route("**/api/voice/speak", async (route) => {
    spoken.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "audio/wav", body: silentWav() });
  });

  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("ayland.replyVoice.muted"));
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await expect(page.getByText("live API")).toBeVisible();

  // Reply 1, unmuted: one synthesis of the cleaned text, in Mongolian.
  await page.getByRole("button", { name: "Бороотой өдөр юу хийх вэ?" }).click();
  await expect(page.getByText("Бороотой үед", { exact: false })).toBeVisible();
  await expect.poll(() => spoken).toEqual([{ text: "Тийм. Бороотой үед театр сайн.", lang: "mn" }]);

  // Reply 2, muted: nothing more is synthesized, and the choice survives a reload.
  await page.getByRole("button", { name: "Хариултыг дуугүй болгох" }).click();
  await page.getByRole("button", { name: "Төсөв хэд үлдсэн бэ?" }).click();
  await expect(page.getByText("Төсөв 68$ үлдсэн.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(spoken).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Хариултыг чангаар унших" })).toBeVisible();
});

test("a failed synthesis leaves the reply on screen", async ({ page }) => {
  await liveBackend(page, ["Өнөөдрийн хөтөлбөр бэлэн."]);
  await page.route("**/api/voice/speak", (route) => route.fulfill({ status: 502, contentType: "application/json", body: '{"detail":"tsuurAI down"}' }));

  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("ayland.replyVoice.muted"));
  await page.getByRole("button", { name: "Live", exact: true }).click();
  await page.getByRole("button", { name: "Төсөв хэд үлдсэн бэ?" }).click();
  await expect(page.getByText("Өнөөдрийн хөтөлбөр бэлэн.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Хариултыг дуугүй болгох" })).toBeVisible();
});
