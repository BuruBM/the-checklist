// Ayudas para las pruebas de punta a punta: servidor local, celular simulado y Supabase simulado.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

export async function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) };
}

export const launch = () => chromium.launch();

// Un «celular» con la app en modo prueba: sin Supabase real y sin fuentes externas.
export async function phone(browser, { now, storage, config = {}, stubSupabase = false, backend } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
    locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (now) await page.clock.install({ time: new Date(now) });
  await page.route("**/config.js", r => r.fulfill({ contentType: "text/javascript", body: "window.JARDIN_CONFIG = " + JSON.stringify(config) + ";" }));
  await page.route("https://fonts.googleapis.com/**", r => r.fulfill({ contentType: "text/css", body: "" }));
  if (stubSupabase) {
    await page.exposeFunction("__be", (arg) => backend(page, arg));
    await page.route("**/vendor/supabase-*.js", r => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOT, "tests/e2e/fixtures/supabase-stub.js"), "utf8") }));
  }
  if (storage) await page.addInitScript(s => { if (!localStorage.getItem("jardin-pendientes-v1")) localStorage.setItem("jardin-pendientes-v1", s); }, JSON.stringify(storage));
  return { ctx, page, errors };
}

export const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("jardin-pendientes-v1") || "{}"));
export async function dump(page, text) { await page.fill("#dump-text", text); await page.click("#dump-add"); }

// Backend falso compartido por varios «dispositivos» (una fila boards, como en Supabase).
export function fakeSupabase() {
  const db = { row: null, session: null, online: true, pages: [], calls: [], subs: new Map() };
  db.handle = async (page, arg) => {
    db.calls.push(arg.op);
    if (arg.op === "session") return db.session;
    if (arg.op === "login") { db.session = arg.session; return null; }
    if (arg.op === "auth") return null;
    const q = arg.q;
    if (!db.online) return { data: null, error: { message: "Failed to fetch" } };
    const f = Object.fromEntries(q.filters);
    if (q.table === "push_subs") {
      if (q.op === "upsert") { db.subs.set(q.row.endpoint, { ...q.row }); return { error: null }; }
      if (q.op === "select") return { data: db.subs.get(f.endpoint) || null, error: null };
      if (q.op === "delete") { db.subs.delete(f.endpoint); return { error: null }; }
    }
    if (q.table !== "boards") return { data: null, error: null };
    if (q.op === "select") return { data: db.row ? { state: db.row.state, rev: db.row.rev, updated_at: db.row.updated_at } : null, error: null };
    if (q.op === "insert") { if (db.row) return { error: { code: "23505", message: "dup" } }; db.row = q.row; notify(page); return { error: null }; }
    if (q.op === "update") { if (!db.row || db.row.rev !== f.rev) return { data: [], error: null }; db.row = q.row; notify(page); return { data: [{ rev: db.row.rev }], error: null }; }
    return { data: null, error: null };
  };
  const notify = (src) => { for (const p of db.pages) if (p !== src) p.evaluate(r => (window.__subs || []).forEach(fn => fn({ new: r })), { rev: db.row.rev }).catch(() => {}); };
  return db;
}
