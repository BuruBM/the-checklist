// Pruebas de punta a punta: la app real en un celular simulado (Playwright).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, launch, phone, saved, dump, fakeSupabase } from "./helpers.mjs";

let server, browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); await server.close(); });
const open = async (opts = {}) => { const d = await phone(browser, opts); await d.page.goto(server.url); return d; };
const PLAYA = { id: "gp", title: "La Playa", emoji: "🏖️", date: "2026-10-10" };
const ESTUDIO = { id: "ge", title: "Estudio médico", emoji: "🩺", date: "2026-10-25" };

test("vaciar la cabeza: interpreta categoría, tamaño, fecha y meta; las etiquetas mandan", async () => {
  const { page, errors, ctx } = await open({ now: "2026-10-02T10:00:00-03:00", storage: { goals: [PLAYA], tasks: [] } });
  await dump(page, "llamar al vete mañana\ncomprar protector para la playa\nterminar informe #personal @rapida\nregar plantas !cada2");
  const by = Object.fromEntries((await saved(page)).tasks.map(t => [t.text, t]));
  assert.deepEqual([by["Llamar al vete"].cat, by["Llamar al vete"].size, by["Llamar al vete"].due], ["gatos", "s", "2026-10-03"]);
  assert.deepEqual([by["Comprar protector para la playa"].cat, by["Comprar protector para la playa"].goal], ["viaje", "gp"]);
  assert.deepEqual([by["Terminar informe"].cat, by["Terminar informe"].size], ["personal", "s"]);
  assert.deepEqual([by["Regar plantas"].cat, by["Regar plantas"].repeat], ["casa", "every2"]);
  assert.match(await page.locator(".toast").first().textContent(), /cosas fuera de tu cabeza/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("completar una tarea planta una flor y suma puntos", async () => {
  const { page, errors, ctx } = await open({ now: "2026-10-02T10:00:00-03:00", storage: { tasks: [{ id: "t1", text: "Pagar expensas", cat: "casa", size: "s", today: true }] } });
  await page.locator(".task", { hasText: "Pagar expensas" }).locator(".check").click();
  assert.equal(await page.textContent("#st-flowers"), "1");
  const s = await saved(page);
  assert.equal(s.tasks[0].done, true);
  assert.ok(s.earned >= 10);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("metas: la más próxima a todo el ancho, filtro al tocarla y cierre cuando vence", async () => {
  const storage = { goals: [PLAYA, ESTUDIO], tasks: [
    { id: "a", text: "Armar valija", cat: "viaje", goal: "gp" }, { id: "b", text: "Comprar protector", cat: "viaje", goal: "gp", done: true, doneAt: 1 },
    { id: "c", text: "Ayuno 8 horas", cat: "salud", goal: "ge" }, { id: "d", text: "Pagar expensas", cat: "casa" }] };
  const { page, errors, ctx } = await open({ now: "2026-10-02T10:00:00-03:00", storage });
  const hero = page.locator(".goal-hero");
  assert.match(await hero.innerText(), /La Playa[\s\S]*8[\s\S]*días[\s\S]*1\/2/);
  assert.ok((await hero.boundingBox()).width > 330);
  assert.equal((await page.locator(".goal-hero").innerText()).split("🏖️").length - 1, 1, "el emoji aparece una sola vez");
  await hero.click();
  await page.click("[data-tab=all]");
  assert.deepEqual(await page.$$eval("#list .task .ttext", els => els.map(e => e.textContent)), ["Armar valija"]);
  assert.ok(await page.isVisible(".goal-info"));
  // Pasa La Playa: se cierra pasando lo pendiente al estudio
  await page.clock.setSystemTime(new Date("2026-10-12T10:00:00-03:00"));
  await page.reload();
  await page.locator(".goal-pill", { hasText: "La Playa" }).click();
  await page.selectOption("#goal-leftover", "ge");
  await page.getByRole("button", { name: "Cerrar meta" }).click();
  const s = await saved(page);
  assert.deepEqual(s.goals.map(g => g.id), ["ge"]);
  assert.equal(s.tasks.find(t => t.id === "a").goal, "ge");
  assert.equal(s.tasks.find(t => t.id === "b").goal, "");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("corregir la categoría en la ficha le enseña a la app", async () => {
  const { page, errors, ctx } = await open({ now: "2026-10-02T10:00:00-03:00", storage: { tasks: [{ id: "t1", text: "Llamar a Celina", cat: "personal", size: "s" }] } });
  await page.click("[data-tab=all]");
  await page.locator(".task", { hasText: "Llamar a Celina" }).locator(".tbody").click();
  await page.selectOption("#ed-cat", "trabajo");
  await page.locator(".sheet button[type=submit]").click();
  assert.match(await page.locator(".toast").last().textContent(), /celina.*Trabajo/);
  await dump(page, "pasarle las fotos a celina");
  const t = (await saved(page)).tasks.find(x => x.text === "Pasarle las fotos a celina");
  assert.equal(t.cat, "trabajo"); // sin lo aprendido sería Creatividad (por «fotos»)
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("una repetida hecha a la 1 de la mañana vuelve ese mismo día a las 5", async () => {
  const { page, errors, ctx } = await open({ now: "2026-10-05T00:30:00-03:00", storage: { tasks: [{ id: "m", text: "Medicar a Milo", cat: "gatos", size: "s", repeat: "daily" }] } });
  await page.locator(".task", { hasText: "Medicar a Milo" }).locator(".check").click();
  await page.clock.setSystemTime(new Date("2026-10-05T04:50:00-03:00")); await page.reload();
  assert.equal(await page.locator("#list .task:not(.done)", { hasText: "Medicar a Milo" }).count(), 0);
  await page.clock.setSystemTime(new Date("2026-10-05T05:10:00-03:00")); await page.reload();
  assert.equal(await page.locator("#list .task:not(.done)", { hasText: "Medicar a Milo" }).count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("dictado: cada pausa es una línea, sin los «tengo que», y sigue escuchando tras un silencio", async () => {
  const { page, errors, ctx } = await phone(browser, {});
  await page.addInitScript(() => {
    window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { window.__rec = this; window.__starts = (window.__starts || 0) + 1; } stop() { setTimeout(() => this.onend && this.onend(), 5); } };
  });
  await page.goto(server.url);
  await page.click("#dump-mic");
  await page.evaluate(() => {
    const fin = (t) => { const r = [{ transcript: t }]; r.isFinal = true; return r; };
    window.__rec.onresult({ resultIndex: 0, results: [fin("tengo que comprar pilas, llamar a la abuela")] });
    window.__rec.onend();
    window.__rec.onresult({ resultIndex: 0, results: [fin("y después pedir turno con la dermatóloga")] });
  });
  assert.equal(await page.evaluate(() => window.__starts), 2);
  await page.click("#dump-mic");
  assert.equal(await page.inputValue("#dump-text"), "comprar pilas\nllamar a la abuela\npedir turno con la dermatóloga\n");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("sincronización entre dos dispositivos, también con cambios hechos sin conexión", async () => {
  const db = fakeSupabase();
  const config = { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" };
  const texts = async (p) => (await saved(p)).tasks.map(t => t.text + (t.done ? "✓" : "")).sort().join(", ");
  const a = await phone(browser, { config, stubSupabase: true, backend: db.handle }); db.pages.push(a.page); await a.page.goto(server.url);
  await dump(a.page, "A #casa\nB #casa\nC #casa");
  await a.page.fill("#acc-email", "yo@mail.com"); await a.page.fill("#acc-pass", "secreto1"); await a.page.click("#acc-login");
  await a.page.waitForTimeout(1200);
  assert.equal(db.row.state.tasks.length, 3);
  const b = await phone(browser, { config, stubSupabase: true, backend: db.handle }); db.pages.push(b.page); await b.page.goto(server.url);
  await b.page.waitForTimeout(1200);
  assert.equal(await texts(b.page), "A, B, C");
  await b.page.click("[data-tab=all]");
  await b.page.locator(".task", { hasText: /^A/ }).locator(".check").first().click();
  await b.page.waitForTimeout(1200);
  assert.equal(await texts(a.page), "A✓, B, C");
  db.online = false;
  await a.page.fill("#add-text", "D"); await a.page.press("#add-text", "Enter");
  await a.page.waitForTimeout(900);
  db.online = true;
  await b.page.fill("#add-text", "E"); await b.page.press("#add-text", "Enter");
  await b.page.waitForTimeout(1200);
  await a.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await a.page.waitForTimeout(1600); await b.page.waitForTimeout(800);
  assert.equal(await texts(a.page), "A✓, B, C, D, E");
  assert.equal(await texts(b.page), "A✓, B, C, D, E");
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.ctx.close(); await b.ctx.close();
});

test("olvidé mi contraseña: manda el mail y, al volver del enlace, pide la nueva", async () => {
  const db = fakeSupabase();
  const { page, errors, ctx } = await phone(browser, { config: { supabaseUrl: "https://x.supabase.co", supabaseKey: "k" }, stubSupabase: true, backend: db.handle });
  await page.goto(server.url);
  await page.fill("#acc-email", "yo@mail.com");
  await page.click("#acc-forgot");
  await page.waitForFunction(() => window.__reset);
  assert.equal(await page.evaluate(() => window.__reset.email), "yo@mail.com");
  await page.evaluate(() => window.__emitAuth("PASSWORD_RECOVERY", { user: { id: "u1", email: "yo@mail.com" } }));
  await page.fill("#new-pass", "nuevaClave1");
  await page.locator(".sheet button[type=submit]").click();
  await page.waitForFunction(() => window.__updated);
  assert.equal(await page.evaluate(() => window.__updated.password), "nuevaClave1");
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("en un celular de 390 px nada se sale de la pantalla", async () => {
  const { page, ctx } = await open({ now: "2026-10-02T10:00:00-03:00", storage: { goals: [PLAYA, ESTUDIO, { id: "gx", title: "Mudanza al depto nuevo", emoji: "🏠", date: "2027-01-10" }], tasks: [{ id: "1", text: "x" }] } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await ctx.close();
});
