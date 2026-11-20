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
  await expect(page.getByRole("heading", { name: /Meet someone new/ })).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia)).toBe(true);
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new axe({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Start chatting free" }).click();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.goto("/connect");
  await expect(page.getByRole("heading", { name: "Sign in to connect" })).toBeVisible();
});

test("a fresh Random Connect search replaces a previous tab's lease", async ({ page, context }) => {
  await provision(page, "QueueTester");
  await page.goto("/connect");
  await page.getByRole("radio", { name: "Text" }).check();
  const firstStart = page.waitForRequest(outgoing => outgoing.url().endsWith("/matchmaking/search") &&
    outgoing.method() === "POST" && outgoing.postDataJSON()?.start === true);
  await page.getByRole("button", { name: "Find a match" }).click();
  const oldSearch = (await firstStart).postDataJSON();
  await expect(page.getByRole("heading", { name: "Looking for someone" })).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto("/connect");
  await secondTab.getByRole("radio", { name: "Voice" }).check();
  await secondTab.getByRole("button", { name: "Find a match" }).click();
  await expect(secondTab.getByRole("heading", { name: "Looking for someone" })).toBeVisible();

  const origin = new URL(page.url()).origin;
  const call = (action: string, data: unknown) =>
    page.request.post(origin + "/api/matchmaking/" + action, { data, headers: { Origin: origin } });
  const oldKey = { search_id: oldSearch.search_id, mode: oldSearch.mode };
  expect((await call("search", oldKey)).status()).toBe(409);
  expect((await call("search", oldSearch)).status()).toBe(409);
  expect((await call("cancel", oldKey)).status()).toBe(204);
  await page.bringToFront();
  await expect(page.getByRole("button", { name: "Start a new search" })).toBeVisible();
  const heartbeat = secondTab.waitForResponse(response => response.url().endsWith("/matchmaking/search") &&
    response.request().method() === "POST" && !response.request().postDataJSON()?.start);
  await secondTab.bringToFront();
  expect((await heartbeat).status()).toBe(200);

  await secondTab.reload();
  await secondTab.getByRole("radio", { name: "Voice" }).check();
  await secondTab.getByRole("button", { name: "Find a match" }).click();
  await expect(secondTab.getByRole("heading", { name: "Looking for someone" })).toBeVisible();
  await secondTab.getByRole("button", { name: "Leave queue" }).click();
  await expect(secondTab.getByRole("button", { name: "Find a match" })).toBeVisible();
});

test("the Random Connect studio supports a local camera preview and mobile layout", async ({ page }) => {
  await provision(page, "CameraTester");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/connect");
  const local = page.getByRole("region", { name: "You", exact: true });
  const remote = page.getByRole("region", { name: "Your match", exact: true });
  const chat = page.getByRole("complementary", { name: "Conversation chat" });
  await Promise.all([expect(remote).toBeVisible(), expect(local).toBeVisible(), expect(chat).toBeVisible()]);
  const [remoteBox, localBox, chatBox] = await Promise.all([remote.boundingBox(), local.boundingBox(), chat.boundingBox()]);
  expect(remoteBox!.x).toBeLessThan(localBox!.x);
  expect(localBox!.x).toBeLessThan(chatBox!.x);
  await local.getByRole("button", { name: "Preview camera" }).click();
  const preview = local.locator("video");
  await expect.poll(() => preview.evaluate(element => element.videoWidth)).toBeGreaterThan(0);
  const camera = await preview.evaluateHandle(video => (video.srcObject as MediaStream).getVideoTracks()[0]);
  await local.getByRole("button", { name: "Stop preview" }).click();
  expect(await camera.evaluate(track => track.readyState)).toBe("ended");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Find a match" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new axe({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

for (const mode of ["Text", "Voice", "Video"] as const) {
  test(`two signed-in accounts exchange ${mode.toLowerCase()} through LiveKit`, async ({ browser }) => {
    const { first, second, alice, amit } = await twoAccounts(browser);
    try {
      await alice.goto("/connect");
      await alice.getByRole("radio", { name: mode }).check();
      await alice.getByRole("button", { name: "Create invitation" }).click();
      const link = await alice.getByLabel("Invitation link").inputValue();
      await amit.goto(link);
      await amit.getByRole("button", { name: "Accept invitation and join" }).click();
      await expect(amit.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(alice.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });

      await alice.getByRole("textbox", { name: "Message", exact: true }).fill("Hello from the other browser.");
      await alice.getByRole("button", { name: "Send", exact: true }).click();
      await expect(amit.getByRole("list", { name: "Conversation messages" })).toContainText("Hello from the other browser.");
      if (mode === "Text") await expect(alice.getByRole("button", { name: "Enable microphone" })).toHaveCount(0);
      if (mode !== "Text") {
        await alice.getByRole("button", { name: "Enable microphone" }).click();
        await expect(alice.getByRole("button", { name: "Mute microphone" })).toBeEnabled({ timeout: 15_000 });
        const audio = amit.getByTestId("remote-audio").locator("audio");
        await expect(audio).toHaveCount(1, { timeout: 15_000 });
        await expect.poll(() => audio.evaluate(element => (element.srcObject as MediaStream | null)?.getAudioTracks()[0]?.readyState)).toBe("live");
      }
      if (mode === "Video") {
        await alice.getByRole("button", { name: "Enable camera" }).click();
        const local = alice.getByTestId("local-preview").locator("video");
        const remote = amit.getByTestId("remote-video").locator("video");
        await expect(local).toHaveCount(1, { timeout: 15_000 });
        await expect(remote).toHaveCount(1, { timeout: 15_000 });
        await expect.poll(() => remote.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
        await amit.reload();
        await expect(amit.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(remote).toHaveCount(1, { timeout: 15_000 });
        await expect.poll(() => remote.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      }
      await amit.getByRole("button", { name: "Report", exact: true }).click();
      await amit.getByLabel("Report reason").selectOption("other");
      await amit.getByRole("button", { name: "Submit report" }).click();
      await expect(amit.getByText("Your report was saved.")).toBeVisible();
      await amit.getByRole("button", { name: "End conversation" }).click();
      await expect(alice.getByRole("button", { name: "Create invitation" })).toBeVisible();
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
}

test("Random Connect waits for mutual consent and can skip to a fresh search", async ({ browser }) => {
  const { first, second, alice, amit } = await twoAccounts(browser);
  try {
    await Promise.all([alice.goto("/connect"), amit.goto("/connect")]);
    await Promise.all([alice.getByRole("radio", { name: "Text" }).check(), amit.getByRole("radio", { name: "Text" }).check()]);
    await alice.getByRole("button", { name: "Find a match" }).click();
    await expect(alice.getByRole("heading", { name: "Looking for someone" })).toBeVisible();
    await amit.getByRole("button", { name: "Find a match" }).click();
    await alice.getByRole("button", { name: "Accept match" }).click();
    await expect(alice.getByText("Waiting for the other participant to accept…")).toBeVisible();
    await amit.getByRole("button", { name: "Accept match" }).click();
    await expect(alice.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(amit.getByText("Connected", { exact: true })).toBeVisible({ timeout: 20_000 });
    await amit.getByRole("button", { name: "Next", exact: true }).click();
    await expect(amit.getByRole("heading", { name: "Looking for someone" })).toBeVisible();
    await amit.getByRole("button", { name: "Leave queue" }).click();
    await expect(amit.getByRole("button", { name: "Find a match" })).toBeVisible();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("Random Connect asks for both devices and publishes only after both people accept", async ({ browser }) => {
  const { first, second, alice, amit } = await twoAccounts(browser);
  try {
    await alice.addInitScript(() => {
      const state = window as typeof window & { allowTestMedia: boolean; testMediaRequests: MediaStreamConstraints[] };
      state.allowTestMedia = false;
      state.testMediaRequests = [];
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => {
        state.testMediaRequests.push(constraints);
        return state.allowTestMedia ? getUserMedia(constraints) : Promise.reject(new DOMException("Denied", "NotAllowedError"));
      };
    });
    await Promise.all([alice.goto("/connect"), amit.goto("/connect")]);
    await alice.getByRole("button", { name: "Find a match" }).click();
    await expect(alice.getByRole("alert").filter({ hasText: "Allow camera and microphone access" })).toBeVisible();
    await expect(alice.getByRole("heading", { name: "Looking for someone" })).toHaveCount(0);
    const mediaControl = alice.evaluate(() => {
      const state = window as typeof window & { allowTestMedia: boolean; testMediaRequests: MediaStreamConstraints[] };
      state.allowTestMedia = true;
      return state.testMediaRequests;
    });
    expect(await mediaControl).toContainEqual({ video: true, audio: true });
    await alice.getByRole("button", { name: "Find a match" }).click();
    await expect(alice.getByRole("heading", { name: "Looking for someone" })).toBeVisible();
    await amit.getByRole("button", { name: "Find a match" }).click();
    await alice.getByRole("button", { name: "Accept match" }).click();
    await expect(alice.getByText("Waiting for the other participant to accept…")).toBeVisible();
    await expect(alice.getByTestId("local-preview")).toHaveCount(0);
    await amit.getByRole("button", { name: "Accept match" }).click();
    for (const page of [alice, amit]) {
      await expect(page.getByRole("button", { name: "Mute microphone" })).toBeEnabled({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Disable camera" })).toBeEnabled();
      await expect(page.getByTestId("remote-video").locator("video")).toHaveCount(1);
      await expect(page.getByTestId("remote-audio").locator("audio")).toHaveCount(1);
    }
    await alice.getByRole("button", { name: "End conversation" }).click();
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
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
