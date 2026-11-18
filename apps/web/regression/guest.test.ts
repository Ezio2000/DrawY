import { expect, it } from "vitest";
import { api, asked, base, context, make, page, setup } from "./harness.ts";

setup({ viewport: { width: 1440, height: 900 } });

async function guest() {
  await context.clearCookies();
  await page.goto(base + "/");
  await page.locator("textarea").waitFor();
}
const dialog = () => page.getByRole("dialog", { name: "Log in to keep creating" });
async function login(password = "password123") {
  await dialog().getByLabel("Username", { exact: true }).fill("desk");
  await dialog().getByLabel("Password", { exact: true }).fill(password);
  await dialog().getByRole("button", { name: "Log in", exact: true }).click();
}

it("lets guests edit the actual home work without saving or losing their prompt", async () => {
  await guest();
  const title=page.getByLabel('Name the studio',{exact:true});
  await expect.poll(()=>title.isEnabled(),{timeout:10000}).toBe(true);
  const drawing=page.frameLocator('iframe[data-preview="editable"]');
  const words=()=>drawing.locator('[data-module-id="sign"]').evaluate(el=>el.shadowRoot!.textContent);
  const roof=()=>drawing.locator('[data-module-id="roof"]').evaluate(el=>el.shadowRoot!.innerHTML);
  const position=()=>drawing.locator('[data-module-id="balloon"]').evaluate(el=>parseFloat((el as HTMLElement).style.left));
  await page.locator('textarea').fill('Keep my drawing request');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect.poll(() => drawing.locator("html").getAttribute("data-edit-transition")).toBe("false");
  await expect.poll(words).toContain("云上画室");
  const originalPosition=await position();
  const before=await roof();
  const house=await drawing.locator('[data-module-id="house"]').evaluate(el=>el.shadowRoot!.innerHTML);
  await title.fill('My Studio');
  await expect.poll(words).toContain('My Studio');
  await page.getByRole('button',{name:'Sage green roof',exact:true}).click();
  await expect.poll(roof, {timeout:5000}).toContain('#698573');
  await page.getByLabel('Move the balloon',{exact:true}).press('End');
  await expect.poll(position, {timeout:5000}).toBe(originalPosition-72);
  await page.waitForTimeout(4200);
  expect(await title.inputValue()).toBe('My Studio');
  expect(await drawing.locator('[data-module-id="house"]').evaluate(el=>el.shadowRoot!.innerHTML)).toBe(house);
  expect(await page.locator('textarea').inputValue()).toBe('Keep my drawing request');
  expect(await dialog().count()).toBe(0);
  expect(asked).toEqual([]);
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await expect.poll(position, {timeout:5000}).toBe(originalPosition);
  await expect.poll(words).toContain('云上画室');
  // The original illustration color is restored, rather than a second image swapped in.
  await expect.poll(roof).not.toContain('#698573');
  expect(before).not.toContain('#698573');
});

it("smoothly edits the home illustration, reverses from the painted state, and pauses mid-flight", async () => {
  await guest();
  const drawing=page.frameLocator('iframe[data-preview="editable"]');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  const color=()=>drawing.locator('[data-module-id="roof"]').evaluate(el=>el.shadowRoot!.querySelector('path')!.getAttribute('fill'));
  const x=()=>drawing.locator('[data-module-id="balloon"]').evaluate(el=>parseFloat((el as HTMLElement).style.left));
  await expect.poll(color, {timeout:5000}).toBe('#d23f2b');
  await page.getByRole('button',{name:'Sage green roof',exact:true}).click();
  await expect.poll(async()=>{ const c=await color();return c!=='#d23f2b' && c!=='#698573'; }).toBe(true);
  await page.getByRole('button',{name:'Vermilion roof',exact:true}).click();
  expect(await color()).not.toBe('#d23f2b');
  await expect.poll(color, {timeout:5000}).toBe('#d23f2b');
  await page.getByLabel('Move the balloon',{exact:true}).press('End');
  await expect.poll(async()=>{const p=await x();return p<968 && p>900;}).toBe(true);
  await page.getByRole('button',{name:'Pause demo',exact:true}).click();
  await page.waitForTimeout(120);
  const stopped=await x();
  expect(stopped).toBeGreaterThan(898);
  expect(stopped).toBeLessThan(970);
  await page.waitForTimeout(250);
  expect(await x()).toBe(stopped);
  await page.getByRole('button',{name:'Play demo',exact:true}).click();
  await page.getByLabel('Move the balloon',{exact:true}).press('Home');
  expect(Math.abs((await x())-stopped)).toBeLessThan(8);
  await expect.poll(x, {timeout:5000}).toBe(970);
  await expect.poll(()=>drawing.locator('html').getAttribute('data-edit-transition')).toBe('false');
  expect(asked).toEqual([]);
});

it("lets guests browse and draft, hides private works, and keeps the draft when sign-in is dismissed", async () => {
  await context.request.post(base + "/api/auth/login", {data:{name:"desk",password:"password123"}});
  await make();
  const privateReads: string[] = [];
  page.on("request", (r) => { if (/\/api\/(works|models|settings)$/.test(r.url())) privateReads.push(r.url()); });
  await guest();
  expect(await page.locator("#home-recent").count()).toBe(0);
  expect(await page.getByRole("navigation", {name:"Explore the works"}).count()).toBe(1);
  await expect.poll(() => page.getByLabel("Name the studio", {exact:true}).isEnabled(), {timeout:10000}).toBe(true);
  await page.locator("textarea").fill("Draw the journey of a drop of water");
  expect(await dialog().count()).toBe(0);
  await page.locator("textarea").press("Enter");
  await dialog().waitFor();
  expect(await page.locator("main").getAttribute("inert")).not.toBeNull();
  await dialog().getByRole("button", { name: "No account yet? Create one" }).click();
  expect(await dialog().getByLabel("Invite code").isVisible()).toBe(true);
  await page.keyboard.press("Escape");
  expect(await dialog().count()).toBe(0);
  expect(await page.locator("textarea").inputValue()).toBe("Draw the journey of a drop of water");
  expect(privateReads).toEqual([]);
  expect(asked).toEqual([]);
  expect((await context.request.get(base + "/api/works")).status()).toBe(401);
  expect((await context.request.get(base + "/api/models")).status()).toBe(401);
});

it("keeps a guest request through failed sign-in and submits it once after the account's models arrive", async () => {
  await guest();
  await page.locator("textarea").fill("Explain how rain reaches a river");
  await page.locator("textarea").press("Enter");
  await login("incorrect123");
  await dialog().getByRole("alert").waitFor();
  expect(asked).toEqual([]);
  expect(await page.locator("textarea").inputValue()).toBe("Explain how rain reaches a river");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/api/models", async (route) => {
    requested = true;
    await held;
    await route.fallback();
  });
  await login();
  await expect.poll(() => requested).toBe(true);
  expect(await dialog().count()).toBe(0);
  expect(asked).toEqual([]);
  release();
  await page.waitForURL(/\/a\//);
  await expect.poll(() => asked.map((a) => a.prompt)).toEqual(["Explain how rain reaches a river"]);
  await page.waitForTimeout(350);
  expect(asked).toHaveLength(1);
});

it("signs in from the guest header without sending the draft and restores recent works", async () => {
  await make();
  await guest();
  await page.locator("textarea").fill("Keep this idea for later");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await login();
  await page.locator("#home-recent").waitFor();
  expect(page.url()).toBe(base + "/");
  expect(await page.locator("textarea").inputValue()).toBe("Keep this idea for later");
  expect(asked).toEqual([]);
});

it("resumes creating a blank canvas after sign-in without sending a draft", async () => {
  const before = (await api("/works")).length;
  await guest();
  await page.locator("textarea").fill("Not sent yet");
  await page.getByRole("button", { name: "New blank canvas", exact: true }).click();
  await login();
  await page.waitForURL(/\/a\//);
  expect((await api("/works")).length).toBe(before + 1);
  expect(asked).toEqual([]);
});

it("keeps the guest sign-in sheet within a narrow screen and cancels an in-flight send intent", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await guest();
  const blank = await page.getByRole("button", { name: "New blank canvas", exact: true }).boundingBox();
  expect(blank!.x + blank!.width).toBeLessThanOrEqual(390);
  await page.locator("textarea").fill("Draw photosynthesis");
  await page.locator("textarea").press("Enter");
  await dialog().waitFor();
  const bounds = await dialog().boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route("**/api/auth/login", async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await login();
  await expect.poll(() => requested).toBe(true);
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  release();
  await page.getByRole("navigation").waitFor();
  expect(page.url()).toBe(base + "/");
  expect(await page.locator("textarea").inputValue()).toBe("Draw photosynthesis");
  expect(asked).toEqual([]);
});

it("still requires sign-in for direct links to private work pages", async () => {
  const work = await make();
  await guest();
  await page.goto(base + "/a/" + work);
  await page.getByLabel("Username", { exact: true }).waitFor();
  expect(await page.locator("textarea").count()).toBe(0);
  expect((await context.request.get(base + "/api/works/" + work)).status()).toBe(401);
  await page.goto(base + "/");
  await page.locator("textarea").waitFor();
  expect(await page.getByLabel("Username", { exact: true }).count()).toBe(0);
});

it("lets guests directly recolor sails and drag the pot with its tree", async () => {
  await guest();
  const hero=page.locator('[data-home-showcase]');
  const boat=hero.frameLocator('iframe[src*="sailboat.html"]'),plant=hero.frameLocator('iframe[src*="botanical.html"]');
  const sails=boat.locator('[data-module-id="sails"]'),pot=plant.locator('[data-module-id="pot"]');
  await sails.waitFor();await pot.waitFor();
  await page.getByRole('button',{name:'Pause demo',exact:true}).click();
  const color=()=>sails.evaluate(el=>el.shadowRoot!.innerHTML);
  const before=await color();await sails.click();
  await expect.poll(color).not.toBe(before);
  expect(await hero.getAttribute('data-edit-phase')).toBe('manual');
  const x=(id:string)=>plant.locator(`[data-module-id="${id}"]`).evaluate(el=>parseFloat((el as HTMLElement).style.left));
  const oldPot=await x('pot'),oldTree=await x('citrus'),can=await x('watering');
  const box=(await pot.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-12,box.y+box.height/2,{steps:6});await page.mouse.up();
  await expect.poll(()=>x('pot')).toBeLessThan(oldPot);
  expect((await x('pot'))-oldPot).toBeCloseTo((await x('citrus'))-oldTree,1);
  expect(await x('watering')).toBe(can);
  await page.waitForTimeout(4500);expect(await color()).not.toBe(before);
  expect(asked).toEqual([]);
  const labels=hero.locator('[data-companion] > button');
  expect(await labels.count()).toBe(2);
});
