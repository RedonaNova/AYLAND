import { expect, type Page, test } from "@playwright/test";

// The welcome flow (docs/superpowers/specs/2026-10-03-welcome-onboarding-design.md): first visit only, the answers
// fill the traveler portrait, and the chat opens with the visitor's name and starter suggestions.

test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" });

const VISITOR = /^v_[0-9a-f-]{36}$/;

const backendDown = (page: Page) =>
  page.route("**/api/profile", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"down"}' }));

const button = (page: Page, name: string) => page.getByRole("dialog").getByRole("button", { name, exact: true });

test("first visit: the answers fill the portrait and the chat greets the visitor by name", async ({ page }) => {
  await backendDown(page);
  await page.goto("/");
  const flow = page.getByRole("dialog");
  await expect(flow.getByRole("heading", { name: "Сайн байна уу! Би AYLAND. Таныг хэн гэдэг вэ?" })).toBeVisible();
  await flow.getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  await button(page, "Дараах").click();

  const portrait = flow.getByRole("region", { name: "Аялагчийн хөрөг" });
  await button(page, "Гэр бүлээрээ").click();
  await button(page, "Хүүхэдтэй").click();
  await expect(portrait.getByText("Гэр бүлээрээ, 4 хүн, хүүхэдтэй")).toBeVisible();
  await button(page, "Дараах").click();

  await button(page, "Дунд зэрэг").click();
  await button(page, "Дараах").click();
  await flow.getByRole("button", { name: /^Тайван/ }).click();
  await button(page, "Дараах").click();
  await button(page, "Далайн хоол идэхгүй").click();
  await expect(portrait.getByText("далайн хоол идэхгүй")).toBeVisible();
  await button(page, "Дараах").click();
  await button(page, "Түүх ба соёл").click();
  await button(page, "Дараах").click();
  await button(page, "Бага зэрэг").click();
  await expect(portrait.getByText("6 / 7")).toBeVisible(); // notes left empty
  await button(page, "Дуусгах").click();

  await expect(flow.getByRole("heading", { name: "Бэлэн боллоо, Сарнай!" })).toBeVisible();
  await expect(flow.getByText("далайн хоол идэхгүй гэснийг тань заавал баримтална", { exact: false })).toBeVisible();
  await expect(flow.getByText("OyuLLM бичсэн")).toHaveCount(0);
  await button(page, "Эхлэх").click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Далайн хоолгүй оройн хоолны газар хайж өгөөч" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("OyuLLM's write-up is shown and credited, and only the answers given reach the backend", async ({ page }) => {
  let sent: { visitor_id: string; answers: Record<string, unknown> } | undefined;
  await page.route("**/api/profile", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary: "Сарнай, таныг ойлголоо.", suggestions: ["Нэг", "Хоёр", "Гурав"], via: "oyu" }),
    });
  });
  await page.goto("/");
  const flow = page.getByRole("dialog");
  await flow.getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  for (let step = 0; step < 6; step++) await button(page, "Дараах").click();
  await button(page, "Дуусгах").click();

  await expect(flow.getByText("Сарнай, таныг ойлголоо.")).toBeVisible();
  await expect(flow.getByText("OyuLLM бичсэн")).toBeVisible();
  expect(sent?.visitor_id).toMatch(VISITOR);
  expect(sent?.answers).toEqual({ name: "Сарнай" });

  await button(page, "Эхлэх").click();
  await expect(page.getByRole("button", { name: "Хоёр", exact: true })).toBeVisible();
});

test("the X skips the flow for good, and the demo controls can replay it", async ({ page }) => {
  await page.goto("/");
  const flow = page.getByRole("dialog");
  await expect(flow).toBeVisible();
  await button(page, "Алгасах").click();
  await expect(flow).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Өглөөний мэнд, Бат!" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Өглөөний мэнд, Бат!" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Танилцуулгыг дахин үзэх" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Enter after clicking an answer moves on and keeps the answer", async ({ page }) => {
  await backendDown(page);
  await page.goto("/");
  const flow = page.getByRole("dialog");
  await flow.getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  await page.keyboard.press("Enter");
  await button(page, "Ганцаараа").click();
  await page.keyboard.press("Enter");
  await expect(flow.getByRole("heading", { name: "Аяллын төсөв тань ямар вэ?" })).toBeVisible();
  await expect(flow.getByRole("region", { name: "Аялагчийн хөрөг" }).getByText("Ганцаараа")).toBeVisible();
});

test("closing the finished screen keeps the answers that were sent", async ({ page }) => {
  await backendDown(page);
  await page.goto("/");
  await page.getByRole("dialog").getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  for (let step = 0; step < 6; step++) await button(page, "Дараах").click();
  await button(page, "Дуусгах").click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Бэлэн боллоо, Сарнай!" })).toBeVisible();
  await button(page, "Хаах").click();
  await expect(page.getByRole("heading", { name: "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" })).toBeVisible();
});

test("answers the backend missed are re-sent on the next visit, without another write-up", async ({ page }) => {
  const posts: Array<Record<string, unknown>> = [];
  let up = false;
  await page.route("**/api/profile", async (route) => {
    posts.push(route.request().postDataJSON());
    if (!up) return route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"down"}' });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: null, suggestions: [], via: null }) });
  });
  await page.goto("/");
  await page.getByRole("dialog").getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  for (let step = 0; step < 6; step++) await button(page, "Дараах").click();
  await button(page, "Дуусгах").click();
  await button(page, "Эхлэх").click();
  await expect(page.getByRole("heading", { name: "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1); // no instant retry in the same page load

  up = true;
  await page.reload();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]).toMatchObject({ answers: { name: "Сарнай" }, summarize: false });
  const synced = () => page.evaluate(() => JSON.parse(localStorage.getItem("ayland.profile") ?? "{}").synced);
  await expect.poll(synced).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(2); // saved now: no more retries
});

test("on a phone the portrait is a pill that opens the card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await backendDown(page);
  await page.goto("/");
  await page.getByRole("dialog").getByRole("textbox", { name: "Нэр" }).fill("Сарнай");
  await button(page, "Дараах").click();
  await button(page, "Хосоороо").click();
  await page.getByRole("button", { name: "Аялагчийн хөрөг · 1" }).click();
  await expect(page.getByRole("region", { name: "Аялагчийн хөрөг" }).getByText("Хосоороо")).toBeVisible();
});
