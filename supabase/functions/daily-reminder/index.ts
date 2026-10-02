// Jardín de pendientes · recordatorio diario
//
// Supabase lo llama cada 15 minutos (pg_cron). A cada dispositivo suscripto le manda:
//   · a la hora elegida, los nombres de lo más urgente de hoy (como mucho 5);
//   · los domingos a esa hora, el repaso de lo vencido;
//   · a la noche (opcional), lo que quedó pendiente de hoy;
//   · las tareas repetidas con 🔔, cada una a su horario.
// También acepta {test: true} desde la app (con la sesión del usuario) para probar.
//
// Sin dependencias: Web Push (RFC 8291 + VAPID RFC 8292) con WebCrypto y la API REST de Supabase.
//
// Secrets que necesita (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET
// Supabase ya provee: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

const APP_URL = "https://burubm.github.io/the-checklist/";
const DAY_START_HOUR = 5;

// ---------------------------------------------------------------- base64url
const enc = new TextEncoder();
export function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// ---------------------------------------------------------------- VAPID (RFC 8292)
export async function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string): Promise<string> {
  const pub = b64urlToBytes(publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)), d: privateKey, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${bytesToB64url(sig)}, k=${publicKey}`;
}

// ---------------------------------------------------------------- payload encryption (RFC 8291, aes128gcm)
export async function encryptPayload(p256dh: string, auth: string, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string,
  vapid: { publicKey: string; privateKey: string; subject: string }): Promise<number> {
  const body = await encryptPayload(sub.p256dh, sub.auth, payload);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(6 * 3600),
      Urgency: "normal",
      Authorization: await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
    },
    body,
  });
  return res.status;
}

// ---------------------------------------------------------------- qué avisar (misma lógica que la app)
type Task = { id?: string; text: string; done?: boolean; today?: boolean; repeat?: string; nextDue?: number; due?: string; goal?: string; size?: string; notifyAt?: string };
type Goal = { id: string; date?: string };
type State = { tasks?: Task[]; goals?: Goal[] } | null;
type Msg = { title: string; body: string; tag: string };
const MAX_LINES = 5;
const SIZE_RANK: Record<string, number> = { s: 0, m: 1, l: 2 };

export function localParts(tz: string, ts: number) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: String(p.weekday) };
}
const logicalDay = (tz: string, now: number) => localParts(tz, now - DAY_START_HOUR * 3600000).day;
const lines = (list: Task[]) => list.slice(0, MAX_LINES).map((t) => `• ${t.text}`).join("\n");

function pieces(state: State, tz: string, now: number) {
  const todayKey = logicalDay(tz, now);
  const tasks = state && Array.isArray(state.tasks) ? state.tasks : [];
  const goals = state && Array.isArray(state.goals) ? state.goals : [];
  const goalDate = (t: Task) => (goals.find((g) => g.id === t.goal) || {}).date || "9999";
  const pending = tasks.filter((t) => !t.done && !t.repeat);
  // Elegidas para hoy: con estrella o que vencen hoy (las vencidas van al repaso semanal; las repetidas, con su propio horario).
  const today = pending.filter((t) => t.today || t.due === todayKey).sort((a, b) =>
    Number(b.due === todayKey) - Number(a.due === todayKey) || goalDate(a).localeCompare(goalDate(b)) || (SIZE_RANK[a.size || "m"] - SIZE_RANK[b.size || "m"]));
  return { todayKey, tasks, goals, pending, today, goalDate };
}

// Mañana: los nombres de lo más urgente del día. Si no elegiste nada, 2 o 3 sugerencias de la meta más próxima.
export function morningMessage(state: State, tz: string, now = Date.now()): Msg | null {
  const { todayKey, pending, today, goals, goalDate } = pieces(state, tz, now);
  if (today.length) return { title: "🌸 Hoy", body: lines(today), tag: "jardin-manana" };
  const open = pending.filter((t) => !t.due || t.due >= todayKey);
  if (!open.length) return null;
  const nextGoal = goals.filter((g) => g.date && g.date >= todayKey && open.some((t) => t.goal === g.id)).sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
  const pool = (nextGoal ? open.filter((t) => t.goal === nextGoal.id) : open)
    .sort((a, b) => (SIZE_RANK[a.size || "m"] - SIZE_RANK[b.size || "m"]) || goalDate(a).localeCompare(goalDate(b)));
  return { title: "🌸 ¿Arrancamos con…?", body: lines(pool.slice(0, 3)), tag: "jardin-manana" };
}

// Noche (opcional): lo que quedó de lo elegido para hoy.
export function eveningMessage(state: State, tz: string, now = Date.now()): Msg | null {
  const { today } = pieces(state, tz, now);
  return today.length ? { title: "🌙 Quedó pendiente", body: lines(today), tag: "jardin-noche" } : null;
}

// Domingo: repaso de las vencidas, de la más vieja a la más nueva.
export function weeklyMessage(state: State, tz: string, now = Date.now()): Msg | null {
  const { todayKey, pending } = pieces(state, tz, now);
  const over = pending.filter((t) => t.due && t.due < todayKey).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  if (!over.length) return null;
  const fmt = (k: string) => { const [, m, d] = k.split("-").map(Number); return `${d}/${m}`; };
  return { title: "↺ Sin resolver", body: over.slice(0, MAX_LINES).map((t) => `• ${t.text} · venció ${fmt(t.due as string)}`).join("\n"), tag: "jardin-semana" };
}

// Repetidas con 🔔: cada una a su horario, si todavía no está hecha hoy.
export function taskAlarms(state: State, tz: string, now = Date.now()): Array<{ key: string; msg: Msg }> {
  const { tasks } = pieces(state, tz, now);
  const { hour, minute } = localParts(tz, now);
  const mins = hour * 60 + minute;
  const out: Array<{ key: string; msg: Msg }> = [];
  for (const t of tasks) {
    if (!t.repeat || !t.notifyAt || !/^\d{2}:\d{2}$/.test(t.notifyAt) || t.done) continue;
    if ((t.nextDue || 0) > now) continue; // ya hecha en este período
    const [h, m] = t.notifyAt.split(":").map(Number);
    const at = h * 60 + m;
    if (mins >= at && mins < at + 180) out.push({ key: `t:${t.id}`, msg: { title: `🔔 ${t.text}`, body: "", tag: `jardin-${t.id}` } });
  }
  return out;
}

// ---------------------------------------------------------------- servidor
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string; hour: number; tz: string; last_sent_day: string | null;
  sent?: Record<string, string>; evening_hour?: number | null; weekly?: boolean };
const inWindow = (hour: number, from: number | null | undefined) => from !== null && from !== undefined && hour >= from && hour < from + 3;

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const env = (k: string) => (DenoRT ? DenoRT.env.get(k) : "") || "";
  const URL_ = env("SUPABASE_URL"), SERVICE = env("SUPABASE_SERVICE_ROLE_KEY"), ANON = env("SUPABASE_ANON_KEY");
  const vapid = { publicKey: env("VAPID_PUBLIC_KEY"), privateKey: env("VAPID_PRIVATE_KEY"), subject: APP_URL };
  if (!vapid.publicKey || !vapid.privateKey) return json({ error: "Faltan los secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY" }, 500);

  const rest = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });

  let body: { test?: boolean } = {};
  try { body = await req.json(); } catch { /* vacío */ }

  // ¿Quién llama? El cron (con el secreto) o la app (con la sesión del usuario, solo para probar).
  let onlyUser = "";
  const isCron = !!env("CRON_SECRET") && req.headers.get("x-cron-secret") === env("CRON_SECRET");
  if (!isCron) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON || SERVICE, Authorization: `Bearer ${token}` } });
    if (!who.ok || !body.test) return json({ error: "No autorizado" }, 401);
    onlyUser = (await who.json()).id;
  }

  const subsRes = await rest(onlyUser ? `push_subs?user_id=eq.${onlyUser}&select=*` : "push_subs?enabled=eq.true&select=*");
  if (!subsRes.ok) return json({ error: "No se pudo leer push_subs", detail: await subsRes.text() }, 500);
  const subs: Sub[] = await subsRes.json();
  if (!subs.length) return json({ sent: 0, checked: 0 });

  const users = [...new Set(subs.map((s) => s.user_id))];
  const boardsRes = await rest(`boards?user_id=in.(${users.join(",")})&select=user_id,state`);
  const boards: Array<{ user_id: string; state: State }> = boardsRes.ok ? await boardsRes.json() : [];
  const stateOf = new Map(boards.map((b) => [b.user_id, b.state]));

  const now = Date.now();
  let sent = 0;
  const results: Array<{ key: string; status: number }> = [];
  for (const s of subs) {
    const tz = s.tz || "America/Argentina/Buenos_Aires";
    const state = stateOf.get(s.user_id) || null;
    const { day, hour, weekday } = localParts(tz, now);
    const modern = s.sent !== undefined; // columnas nuevas creadas (notifications.sql actualizado)
    const done: Record<string, string> = modern ? { ...(s.sent || {}) } : { morning: s.last_sent_day || "" };
    const todo: Array<{ key: string; msg: Msg | null }> = [];

    if (onlyUser) {
      todo.push({ key: "test", msg: morningMessage(state, tz, now) || { title: "🌸 Hoy", body: "No hay nada pendiente.", tag: "jardin-manana" } });
    } else {
      if (inWindow(hour, s.hour) && done.morning !== day) todo.push({ key: "morning", msg: morningMessage(state, tz, now) });
      if (modern) {
        if (weekday === "Sun" && s.weekly !== false && inWindow(hour, s.hour) && done.weekly !== day) todo.push({ key: "weekly", msg: weeklyMessage(state, tz, now) });
        if (inWindow(hour, s.evening_hour) && done.evening !== day) todo.push({ key: "evening", msg: eveningMessage(state, tz, now) });
        for (const a of taskAlarms(state, tz, now)) if (done[a.key] !== day) todo.push(a);
      }
    }
    if (!todo.length) continue;

    let gone = false;
    for (const { key, msg } of todo) {
      done[key] = day; // aunque no haya nada que decir, ese aviso ya quedó resuelto por hoy
      if (!msg) continue;
      let status = 0;
      try { status = await sendPush(s, JSON.stringify({ ...msg, url: APP_URL }), vapid); } catch (_) { status = 0; }
      results.push({ key, status });
      if (status === 404 || status === 410) { gone = true; break; }
      if (status >= 200 && status < 300) sent++;
    }
    const ep = encodeURIComponent(s.endpoint);
    if (gone) { await rest(`push_subs?endpoint=eq.${ep}`, { method: "DELETE" }); continue; } // el dispositivo ya no existe
    if (onlyUser) continue;
    const keep = Object.fromEntries(Object.entries(done).filter(([, d]) => d === day));
    await rest(`push_subs?endpoint=eq.${ep}`, { method: "PATCH", body: JSON.stringify(modern ? { sent: keep, last_sent_day: done.morning || null } : { last_sent_day: done.morning || null }) });
  }
  return json({ sent, checked: subs.length, results });
}

// deno-lint-ignore no-explicit-any
const DenoRT = (globalThis as any).Deno;
if (DenoRT && DenoRT.serve) DenoRT.serve(handler);
