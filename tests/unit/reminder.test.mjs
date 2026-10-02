// Notificaciones (Edge Function): qué dice cada aviso, cuándo sale, y que el cifrado sea válido.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ece from "http_ece";
import { morningMessage, eveningMessage, weeklyMessage, taskAlarms, sendPush, encryptPayload } from "../../supabase/functions/daily-reminder/index.ts";

const TZ = "America/Argentina/Buenos_Aires";
const at = (iso) => new Date(iso).getTime();
const state = () => ({ goals: [{ id: "gp", title: "La Playa", date: "2026-10-10" }], tasks: [
  { id: "1", text: "Llamar al gasista", today: true, size: "s", goal: "gp" },
  { id: "2", text: "Pagar expensas", due: "2026-10-04", size: "s" },
  { id: "3", text: "Comprar Royal Canin", today: true, size: "m" },
  { id: "4", text: "Revisar Despegar", today: true, size: "s", goal: "gp" },
  { id: "5", text: "Pintar pared", today: true, size: "l" },
  { id: "6", text: "Tapar hueco", today: true, size: "m" },
  { id: "7", text: "Mandar form Gates", due: "2026-09-28", size: "s" },
  { id: "9", text: "Medicar a Milo", repeat: "daily", nextDue: 0, notifyAt: "21:00" },
  { id: "10", text: "Medicar a Zoe", repeat: "weekly", nextDue: at("2026-10-08T05:00:00-03:00"), notifyAt: "10:00" },
  { id: "11", text: "Hecha", today: true, done: true } ] });

test("mañana: solo nombres, como mucho 5, primero lo que vence hoy, sin repetidas ni vencidas", () => {
  const m = morningMessage(state(), TZ, at("2026-10-04T09:05:00-03:00"));
  assert.equal(m.title, "🌸 Hoy");
  assert.deepEqual(m.body.split("\n"), ["• Pagar expensas", "• Llamar al gasista", "• Revisar Despegar", "• Comprar Royal Canin", "• Tapar hueco"]);
  assert.ok(!/más|\d+ tareas/.test(m.body));
});

test("mañana sin nada elegido: sugiere de la meta más próxima; sin pendientes: no avisa", () => {
  const s = state(); s.tasks.forEach(t => { t.today = false; delete t.due; });
  const m = morningMessage(s, TZ, at("2026-10-05T09:00:00-03:00"));
  assert.equal(m.title, "🌸 ¿Arrancamos con…?");
  assert.deepEqual(m.body.split("\n"), ["• Llamar al gasista", "• Revisar Despegar"]);
  assert.equal(morningMessage({ tasks: [] }, TZ, at("2026-10-05T09:00:00-03:00")), null);
});

test("domingo: repaso de vencidas con fecha; noche: lo que quedó", () => {
  const w = weeklyMessage(state(), TZ, at("2026-10-05T09:00:00-03:00"));
  assert.deepEqual(w.body.split("\n"), ["• Mandar form Gates · venció 28/9", "• Pagar expensas · venció 4/10"]);
  assert.equal(eveningMessage(state(), TZ, at("2026-10-04T21:00:00-03:00")).title, "🌙 Quedó pendiente");
});

test("repetidas con 🔔: a su hora, solo si todavía no se hicieron", () => {
  assert.deepEqual(taskAlarms(state(), TZ, at("2026-10-04T20:50:00-03:00")), []);
  assert.deepEqual(taskAlarms(state(), TZ, at("2026-10-04T21:05:00-03:00")).map(a => a.msg.title), ["🔔 Medicar a Milo"]);
  assert.deepEqual(taskAlarms(state(), TZ, at("2026-10-05T10:05:00-03:00")), []); // Zoe ya hecha esta semana; Milo recién a las 21
});

test("el aviso cifrado se puede descifrar como lo haría el celular (RFC 8291) y la firma VAPID es válida", async () => {
  const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const kp = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = kp.privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
  const payload = JSON.stringify({ title: "🌸 Hoy", body: "• Llamar al gasista" });
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response(null, { status: 201 }); };
  try {
    const status = await sendPush({ endpoint: "https://push.example/x", p256dh: ua.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") },
      payload, { publicKey: pub, privateKey: jwk.d, subject: "https://burubm.github.io/the-checklist/" });
    assert.equal(status, 201);
  } finally { globalThis.fetch = realFetch; }
  const plain = ece.decrypt(Buffer.from(captured.init.body), { version: "aes128gcm", privateKey: ua, authSecret });
  assert.equal(plain.toString(), payload);
  const [, t, k] = captured.init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, sig] = t.split(".");
  assert.equal(k, pub);
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: kp.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  assert.equal(JSON.parse(Buffer.from(c, "base64url")).aud, "https://push.example");
  assert.ok(encryptPayload);
});
