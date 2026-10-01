// Jardín de pendientes · recordatorio diario
//
// Supabase lo llama cada 15 minutos (pg_cron). A cada dispositivo suscripto le manda,
// a la hora que eligió, una notificación con las tareas de "Hoy".
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

// ---------------------------------------------------------------- tareas de hoy (misma lógica que la app)
type Task = { text: string; done?: boolean; today?: boolean; repeat?: string; nextDue?: number; due?: string };

export function localParts(tz: string, ts: number) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function todayTasks(state: { tasks?: Task[] } | null, tz: string, now = Date.now()) {
  const todayKey = localParts(tz, now - DAY_START_HOUR * 3600000).day;
  const tasks = (state && Array.isArray(state.tasks)) ? state.tasks : [];
  const pending = tasks.filter((t) => !t.done && !(t.repeat && (t.nextDue || 0) > now));
  const list = pending.filter((t) => t.today || !!t.repeat || (!!t.due && t.due <= todayKey));
  list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || Number(!!b.today) - Number(!!a.today));
  const overdue = list.filter((t) => t.due && t.due < todayKey).length;
  return { list, overdue, pendingCount: pending.length };
}

export function buildMessage(state: { tasks?: Task[] } | null, tz: string, now = Date.now()) {
  const { list, overdue, pendingCount } = todayTasks(state, tz, now);
  if (!list.length) {
    return {
      title: "🌸 Buen día",
      body: pendingCount ? "Hoy no tienes nada elegido. Entra y marca 2 o 3 cosas para hoy." : "No tienes nada pendiente. Disfruta tu jardín.",
    };
  }
  const names = list.slice(0, 3).map((t) => t.text);
  const more = list.length > 3 ? ` y ${list.length - 3} más` : "";
  return {
    title: `🌸 Hoy: ${list.length} ${list.length === 1 ? "tarea" : "tareas"}` + (overdue ? ` (${overdue} vencida${overdue > 1 ? "s" : ""})` : ""),
    body: names.join(" · ") + more,
  };
}

// ---------------------------------------------------------------- servidor
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
  const subs: Array<{ endpoint: string; user_id: string; p256dh: string; auth: string; hour: number; tz: string; last_sent_day: string | null }> = await subsRes.json();

  const now = Date.now();
  const due = subs.filter((s) => {
    if (onlyUser) return true;
    const tz = s.tz || "America/Argentina/Buenos_Aires";
    const { day, hour } = localParts(tz, now);
    return hour >= s.hour && hour < s.hour + 3 && s.last_sent_day !== day;
  });
  if (!due.length) return json({ sent: 0, checked: subs.length });

  const users = [...new Set(due.map((s) => s.user_id))];
  const boardsRes = await rest(`boards?user_id=in.(${users.join(",")})&select=user_id,state`);
  const boards: Array<{ user_id: string; state: { tasks?: Task[] } }> = boardsRes.ok ? await boardsRes.json() : [];
  const stateOf = new Map(boards.map((b) => [b.user_id, b.state]));

  let sent = 0;
  const results: Array<{ status: number }> = [];
  for (const s of due) {
    const tz = s.tz || "America/Argentina/Buenos_Aires";
    const msg = buildMessage(stateOf.get(s.user_id) || null, tz, now);
    const payload = JSON.stringify({ ...msg, url: APP_URL, tag: "jardin-diario" });
    let status = 0;
    try { status = await sendPush(s, payload, vapid); } catch (_) { status = 0; }
    results.push({ status });
    const ep = encodeURIComponent(s.endpoint);
    if (status === 404 || status === 410) {
      await rest(`push_subs?endpoint=eq.${ep}`, { method: "DELETE" }); // el dispositivo ya no existe
    } else if (status >= 200 && status < 300) {
      sent++;
      if (!onlyUser) await rest(`push_subs?endpoint=eq.${ep}`, { method: "PATCH", body: JSON.stringify({ last_sent_day: localParts(tz, now).day }) });
    }
  }
  return json({ sent, checked: subs.length, results });
}

// deno-lint-ignore no-explicit-any
const DenoRT = (globalThis as any).Deno;
if (DenoRT && DenoRT.serve) DenoRT.serve(handler);
