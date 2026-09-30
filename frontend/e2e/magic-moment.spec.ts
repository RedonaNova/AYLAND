import { expect, test } from "@playwright/test";

const AGENT_TIMEOUT = { timeout: 15_000 };

test("magic moment: rain → options → consent → booking → re-plan (HANDBOOK §3)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Өглөөний мэнд, Бат!" })).toBeVisible();
  await expect(page.getByText("$100").filter({ visible: true }).first()).toBeVisible();

  // Act 1: the presenter switches the scenario to rain; AYLAND flags it unprompted.
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("Бороо орж эхэллээ", { exact: false })).toBeVisible(AGENT_TIMEOUT);

  // Act 2: ask for rainy-day options within budget.
  await page.getByRole("button", { name: "Тийм, хувилбар санал болго" }).click();
  await expect(page.getByRole("heading", { name: "Вьетнам хоол хийх анги" }).first()).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByText("Гурвуулаа төсөвт багтана", { exact: false })).toBeVisible(AGENT_TIMEOUT);

  // Act 3: book the second option; nothing is booked until the approval tap.
  await page.getByRole("button", { name: "Хоёр дахийг нь захиал" }).click();
  await expect(page.getByText("Таны зөвшөөрөл хэрэгтэй")).toBeVisible(AGENT_TIMEOUT);
  const approve = page.getByRole("button", { name: "Зөвшөөрөх", exact: true });
  await approve.click();

  await expect(page.getByText("Захиалга баталгаажлаа!", { exact: false })).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByText(/AYL-[A-Z0-9]{4}/).first()).toBeVisible();
  await expect(page.getByText("$57").filter({ visible: true }).first()).toBeVisible();
  // The consent card is spent: no second approval is possible.
  await expect(approve).toHaveCount(0);
});

test("consent gate: a newer proposal expires the older one, and 'yes' books the card on screen", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Бороотой өдөр юу хийх вэ?" }).click();
  await expect(page.getByText("Гурвуулаа төсөвт багтана", { exact: false })).toBeVisible(AGENT_TIMEOUT);
  await page.getByRole("button", { name: "Эхнийхийг нь захиал" }).click();
  await expect(page.getByText("Таны зөвшөөрөл хэрэгтэй")).toBeVisible(AGENT_TIMEOUT);

  const input = page.locator("#composer-input");
  await input.fill("Хоёр дахь хувилбарыг захиалаад өгөөч.");
  await input.press("Enter");
  await expect(page.getByText("Хүчингүй болсон")).toBeVisible(AGENT_TIMEOUT);
  await expect(page.getByRole("button", { name: "Зөвшөөрөх", exact: true })).toHaveCount(1);

  await input.fill("Тийм, захиал.");
  await input.press("Enter");
  await expect(page.getByText("14:00 цагт Вьетнам хоол хийх анги нэмэгдлээ")).toBeVisible(AGENT_TIMEOUT);
});

test("declining closes the card for good", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Бороотой өдөр юу хийх вэ?" }).click();
  await expect(page.getByText("Гурвуулаа төсөвт багтана", { exact: false })).toBeVisible(AGENT_TIMEOUT);
  await page.getByRole("button", { name: "Хоёр дахийг нь захиал" }).click();
  await expect(page.getByText("Таны зөвшөөрөл хэрэгтэй")).toBeVisible(AGENT_TIMEOUT);

  await page.getByRole("button", { name: "Татгалзах" }).click();
  await expect(page.getByText("Татгалзсан", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Зөвшөөрөх", exact: true })).toHaveCount(0);
  await expect(page.getByText("Ойлголоо, захиалахгүй.", { exact: false })).toHaveCount(1);
});

test("voice input shows the transcript before it is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Дуугаар асуух" }).click();
  const input = page.locator("#composer-input");
  await expect(input).toHaveValue(/бороо орчихлоо/, AGENT_TIMEOUT);
  await input.press("Enter");
  await expect(page.getByText("STT · mn-MN")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Усан хүүхэлдэйн театр" })).toBeVisible(AGENT_TIMEOUT);
});

test("interpreter translates Mongolian to Vietnamese (Act 4)", async ({ page }) => {
  await page.goto("/interpreter");
  await page.getByRole("button", { name: /^Би/ }).click();
  await expect(page.getByText("Xin chào, chúng tôi đã đặt lớp nấu ăn cho 4 người.", { exact: false }).first()).toBeVisible(AGENT_TIMEOUT);
});

test("pages load without console errors (desktop and mobile sheet)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  for (const path of ["/", "/trip", "/interpreter", "/agents"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /\$100/ }).click();
  await expect(page.getByText("Өнөөдрийн хөтөлбөр").first()).toBeVisible();
  await page.waitForTimeout(1500);

  expect(errors.filter((e) => !e.includes("tile.openstreetmap.org"))).toEqual([]);
});

test("demo reset restores the seeded day", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Alt+KeyR");
  await expect(page.getByText("Бороо орж эхэллээ", { exact: false })).toBeVisible(AGENT_TIMEOUT);
  await page.keyboard.press("Alt+KeyN");
  await expect(page.getByRole("heading", { name: "Өглөөний мэнд, Бат!" })).toBeVisible();
  await expect(page.getByText("Бороо орж эхэллээ", { exact: false })).toHaveCount(0);
});
