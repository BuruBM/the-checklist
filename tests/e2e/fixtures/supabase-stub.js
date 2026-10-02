// Supabase de mentira para las pruebas: cada consulta va a window.__be (lado Node), compartido entre «dispositivos».
window.supabase = { createClient() {
  const listeners = []; let session = null;
  const emit = (ev, s) => listeners.forEach(l => l(ev, s));
  window.__emitAuth = emit;
  const auth = {
    onAuthStateChange(cb) { listeners.push(cb); setTimeout(async () => { session = await window.__be({ op: "session" }); cb("INITIAL_SESSION", session); }, 10); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email }) { session = { user: { id: "u1", email } }; await window.__be({ op: "login", session }); emit("SIGNED_IN", session); return { error: null }; },
    async signUp() { return { data: {}, error: null }; },
    async signOut() { session = null; emit("SIGNED_OUT", null); return {}; },
    async resetPasswordForEmail(email, opts) { window.__reset = { email, opts }; await window.__be({ op: "auth" }); return { error: null }; },
    async updateUser(u) { window.__updated = u; return { data: {}, error: null }; },
    async getSession() { return { data: { session } }; },
  };
  function from(table) {
    const q = { table, filters: [] };
    const b = {
      select() { if (!q.op) q.op = "select"; return b; }, update(row) { q.op = "update"; q.row = row; return b; },
      insert(row) { q.op = "insert"; q.row = row; return b; }, upsert(row) { q.op = "upsert"; q.row = row; return b; },
      delete() { q.op = "delete"; return b; }, eq(k, v) { q.filters.push([k, v]); return b; }, maybeSingle() { return b; },
      then(res, rej) { return window.__be({ op: "query", q }).then(res, rej); },
    };
    return b;
  }
  const channel = () => { const c = { on(_, __, fn) { (window.__subs = window.__subs || []).push(fn); return c; }, subscribe() { return c; } }; return c; };
  return { auth, from, channel, removeChannel() {} };
} };
