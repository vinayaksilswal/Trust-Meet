import { randomUUID } from "node:crypto";
import axe from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

const password = "test only long password 23!";

async function provision(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/account/register");
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create an account" }).click();
  await expect(page.getByRole("status")).toHaveText(/You can sign in now/);
  await page.getByRole("link", { name: "Sign in", exact: true }).last().click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await page.getByLabel("Date of birth").fill("1990-06-15");
  await page.getByRole("button", { name: "Check my age" }).click();
  await expect(page.getByRole("status")).toHaveText(/18\+ age check complete/);
}

async function twoAccounts(browser: Browser) {
  const first = await browser.newContext({ permissions: ["camera", "microphone"] });
  const second = await browser.newContext({ permissions: ["camera", "microphone"] });
  const alice = await first.newPage();
  const amit = await second.newPage();
  await Promise.all([provision(alice, "Ananya"), provision(amit, "Amit")]);
  return { first, second, alice, amit };
}

test("discovery is accessible and fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Talk With Strangers Online" })).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia)).toBe(true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new axe({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Start Video Chat" }).click();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.goto("/connect");
  await expect(page.getByRole("link", { name: "Sign in to start" })).toBeVisible();
});

test("random video connects two people instantly and Next moves both on", async ({ browser }) => {
  const { first, second, alice, amit } = await twoAccounts(browser);
  try {
    await Promise.all([alice.goto("/connect"), amit.goto("/connect")]);
    await alice.getByRole("button", { name: /^Start/ }).click();
    await expect(alice.getByText("Looking for someone to talk to…")).toBeVisible();
    await expect(alice.getByTestId("local-preview")).toBeVisible();
    await amit.keyboard.press("Space");
    for (const page of [alice, amit]) {
      await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
      const remote = page.getByTestId("remote-video").locator("video");
      await expect(remote).toHaveCount(1, { timeout: 15_000 });
      await expect.poll(() => remote.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      await expect(page.getByTestId("remote-audio").locator("audio")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Mute microphone" })).toBeEnabled();
    }
    await alice.getByRole("textbox", { name: "Message" }).fill("Hello from the other browser.");
    await alice.getByRole("button", { name: "Send" }).click();
    await expect(amit.getByRole("list", { name: "Conversation messages" })).toContainText("Hello from the other browser.");

    await amit.getByRole("button", { name: "Report" }).click();
    await amit.getByLabel("Report reason").selectOption("other");
    await amit.getByRole("button", { name: "Submit report" }).click();
    await expect(amit.getByText("Your report was sent to moderation.")).toBeVisible();

    // Next ends the call for both people and puts both back in the queue.
    await amit.getByRole("button", { name: /^Next/ }).click();
    await expect(amit.getByText("Looking for someone to talk to…")).toBeVisible({ timeout: 10_000 });
    await expect(alice.getByText("Looking for someone to talk to…")).toBeVisible({ timeout: 10_000 });
    await amit.getByRole("button", { name: /^Stop/ }).click();
    await alice.keyboard.press("Escape");
    for (const page of [alice, amit]) await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("random text chat connects without a camera", async ({ browser }) => {
  const { first, second, alice, amit } = await twoAccounts(browser);
  try {
    await Promise.all([alice.goto("/connect?mode=text"), amit.goto("/connect?mode=text")]);
    await alice.getByRole("button", { name: "Start chat" }).click();
    await amit.getByRole("button", { name: "Start chat" }).click();
    for (const page of [alice, amit]) await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(alice.getByRole("button", { name: "Mute microphone" })).toHaveCount(0);
    await amit.getByRole("textbox", { name: "Message" }).fill("Text only works too.");
    await amit.getByRole("button", { name: "Send" }).click();
    await expect(alice.getByRole("list", { name: "Conversation messages" })).toContainText("Text only works too.");
    await alice.getByRole("button", { name: /^Stop/ }).click();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("random video needs device access and filters need a pass", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { allowTestMedia: boolean };
    state.allowTestMedia = false;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints =>
      state.allowTestMedia ? getUserMedia(constraints) : Promise.reject(new DOMException("Denied", "NotAllowedError"));
  });
  await provision(page, "FilterTester");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/connect");
  const stranger = page.getByRole("region", { name: "Stranger", exact: true });
  const local = page.getByRole("region", { name: "You", exact: true });
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  const [strangerBox, localBox, panelBox] = await Promise.all([stranger.boundingBox(), local.boundingBox(), panel.boundingBox()]);
  expect(strangerBox!.x).toBeLessThan(localBox!.x);
  expect(localBox!.x).toBeLessThan(panelBox!.x);
  await expect(panel).toContainText("You must be 18+");

  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Allow camera and microphone access" })).toBeVisible();
  await expect(page.getByText("Looking for someone to talk to…")).toHaveCount(0);

  await page.getByRole("button", { name: /Region/ }).click();
  const dialog = page.getByRole("dialog", { name: "Unlock Region Filter" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("7 DAYS")).toBeVisible();
  await expect(dialog.getByText("BEST VALUE")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const filtered = await page.request.post(origin + "/api/matchmaking/search", { headers: { Origin: origin },
    data: { search_id: randomUUID(), mode: "video", start: true, want_gender: "female" } });
  expect(filtered.status()).toBe(402);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new axe({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("private room hosts can approve, mute, and remove guests in a group LiveKit call", async ({ browser }) => {
  const { first, second, alice, amit } = await twoAccounts(browser);
  const extra = await browser.newContext({ permissions: ["camera", "microphone"] });
  const guest = await extra.newPage();
  try {
    await provision(guest, "Isha");
    await alice.goto("/private-rooms");
    await alice.getByLabel("Room title").fill("Founder discussion");
    await alice.getByRole("combobox", { name: "Mode", exact: true }).selectOption("video");
    await alice.getByLabel("Room password (optional)").fill("local-group-password");
    await alice.getByRole("button", { name: "Create private room" }).click();
    await alice.getByRole("button", { name: "Create room invitation" }).click();
    const invitation = await alice.getByLabel("Room invitation link").inputValue();
    for (const person of [amit, guest]) {
      await person.goto(invitation);
      await person.getByLabel("Invitation password (if required)").fill("local-group-password");
      await person.getByRole("button", { name: "Request to join" }).click();
      await expect(person.getByText("Waiting for the host to approve your request.")).toBeVisible();
    }
    await alice.getByRole("button", { name: "Approve Amit" }).click();
    await alice.getByRole("button", { name: "Approve Isha" }).click();
    for (const person of [alice, amit, guest]) {
      await person.getByRole("button", { name: "Join call" }).click();
    }
    for (const person of [alice, amit, guest]) {
      await expect(person.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await amit.getByRole("textbox", { name: "Message", exact: true }).fill("Group message");
    await amit.getByRole("button", { name: "Send", exact: true }).click();
    for (const person of [alice, guest]) {
      await expect(person.getByRole("list", { name: "Conversation messages" })).toContainText("Amit: Group message");
    }
    await amit.getByRole("button", { name: "Enable microphone" }).click();
    await expect(guest.getByTestId("remote-audio").locator("audio")).toHaveCount(1, { timeout: 15_000 });
    await alice.getByRole("button", { name: "Enable camera" }).click();
    const video = guest.getByTestId("remote-video").locator("video");
    await expect(video).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
    await alice.getByRole("button", { name: "Mute Amit" }).click();
    await expect(amit.getByRole("button", { name: "Enable microphone" })).toBeEnabled();
    await guest.getByRole("button", { name: "Report", exact: true }).click();
    await guest.getByLabel("Report reason").selectOption("other");
    await guest.getByRole("button", { name: "Submit report" }).click();
    await expect(guest.getByText("Your report was saved.")).toBeVisible();
    await alice.getByRole("button", { name: "Remove Amit" }).click();
    await expect(amit.getByText("You no longer have access to this room.")).toBeVisible();
    await alice.getByRole("button", { name: "Close room", exact: true }).click();
    await alice.getByRole("button", { name: "Confirm close" }).click();
    await expect(guest.getByText("This room has closed.")).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close(), extra.close()]);
  }
});
