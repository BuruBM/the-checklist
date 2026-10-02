// Jardín de pendientes · núcleo de datos (sin DOM): normalizar, migrar y combinar estados.
// Lo usa la app en el navegador (window.JardinCore) y las pruebas en Node (require).
(function (root) {
  "use strict";

  const CATS = {
    gatos: { label: "Gatos", color: "var(--c-gatos)" },
    casa: { label: "Casa", color: "var(--c-casa)" },
    viaje: { label: "Viaje", color: "var(--c-viaje)" },
    trabajo: { label: "Trabajo", color: "var(--c-trabajo)" },
    recados: { label: "Compras", color: "var(--c-recados)" },
    salud: { label: "Salud y cuidado", color: "var(--c-salud)" },
    creatividad: { label: "Creatividad", color: "var(--c-creatividad)" },
    personal: { label: "Personal", color: "var(--c-personal)" },
    otros: { label: "Otros", color: "var(--c-otros)" },
  };
  const SIZES = {
    s: { label: "Rapidita", pts: 10, seeds: "•" },
    m: { label: "Mediana", pts: 25, seeds: "••" },
    l: { label: "Grande", pts: 50, seeds: "•••" },
  };
  const blank = () => ({ tasks: [], rewards: [], earned: 0, spent: 0, days: {}, badges: {}, redeemed: [], lastDoneAt: 0, comboCount: 0, archived: [], cleared: 0, lastBackup: 0, goalTitle: "", goalDate: "", deleted: [], goals: [], learned: { cat: {}, size: {} } });
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  // El día de la app empieza a las 5 de la mañana: lo que hacés a la 1 cuenta para el día anterior.
  const DAY_START_HOUR = 5, HOUR = 3600000;
  const logicalDate = (ts = Date.now()) => new Date(Number(ts) - DAY_START_HOUR * HOUR);
  const dayKey = (d = new Date()) => logicalDate(d.getTime()).toLocaleDateString("sv-SE");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // Si el nombre de una meta trae un emoji («La Playa 🏖️»), el emoji pasa a ser su ícono y sale del nombre.
  const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/gu;
  function splitGoalTitle(title, emoji) {
    const found = (title || "").match(EMOJI_RE);
    if (!found) return { title: (title || "").trim(), emoji };
    const clean = title.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").replace(/\s+([:,.;!?])/g, "$1").replace(/[\s:–-]+$/, "").trim();
    return { title: clean || title.trim(), emoji: found[0] };
  }
  function guessEmoji(title) {
    const w = (title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/playa|mar|vacacion/.test(w)) return "🏖️";
    if (/viaje|vuelo/.test(w)) return "✈️";
    if (/medic|estudio|turno|salud|analisis/.test(w)) return "🩺";
    if (/mudanza|casa|depto/.test(w)) return "🏠";
    if (/trabajo|entrega|cliente|proyecto/.test(w)) return "💼";
    if (/examen|curso|facu/.test(w)) return "🎓";
    if (/cumple|fiesta|evento/.test(w)) return "🎉";
    return "🎯";
  }
  function normalize(s) {
    const b = blank();
    if (!s || typeof s !== "object") return b;
    for (const k of Object.keys(b)) if (s[k] !== undefined && typeof s[k] === typeof b[k]) b[k] = s[k];
    // Antes había una sola meta (goalTitle/goalDate): pasa a ser la primera de la lista, con sus tareas.
    const legacy = !Array.isArray(s.goals) && /^\d{4}-\d{2}-\d{2}$/.test(s.goalDate || "");
    b.tasks = (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && typeof t.text === "string").map(t => ({
      id: String(t.id || uid()), text: t.text.slice(0, 200), cat: CATS[t.cat] ? t.cat : "otros",
      size: SIZES[t.size] ? t.size : "m", today: !!t.today, done: !!t.done, doneAt: t.doneAt || 0, createdAt: t.createdAt || Date.now(),
      earned: Number(t.earned) || 0,
      repeat: ["daily", "every2", "weekly"].includes(t.repeat) ? t.repeat : "", nextDue: Number(t.nextDue) || 0,
      parentId: t.parentId ? String(t.parentId) : "",
      due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || "") ? t.due : "",
      notifyAt: t.repeat && /^\d{2}:\d{2}$/.test(t.notifyAt || "") ? t.notifyAt : "",
      goal: typeof t.goal === "string" ? t.goal : (legacy && !t.later && !t.repeat && !t.parentId ? "g-legacy" : ""),
      editedAt: Number(t.editedAt) || 0,
    }));
    b.rewards = (Array.isArray(s.rewards) ? s.rewards : []).filter(r => r && typeof r.text === "string")
      .map(r => ({ id: String(r.id || uid()), text: r.text.slice(0, 80), cost: Math.max(5, Number(r.cost) || 50) }));
    b.redeemed = Array.isArray(s.redeemed) ? s.redeemed.slice(-100) : [];
    const okMap = (o, allowed) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => typeof k === "string" && allowed(v)).slice(-300));
    b.learned = { cat: okMap(s.learned && s.learned.cat, v => !!CATS[v]), size: okMap(s.learned && s.learned.size, v => !!SIZES[v]) };
    b.deleted = (Array.isArray(s.deleted) ? s.deleted : []).map(String).slice(-400);
    b.archived = (Array.isArray(s.archived) ? s.archived : []).filter(a => a && a.id).slice(-70);
    b.goals = (Array.isArray(s.goals) ? s.goals : []).filter(g => g && g.id && typeof g.title === "string").map(g => ({
      id: String(g.id), title: g.title.slice(0, 40), emoji: typeof g.emoji === "string" && g.emoji ? g.emoji.slice(0, 8) : "🎯",
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") ? g.date : "", cleared: Number(g.cleared) || 0, createdAt: Number(g.createdAt) || 0,
    }));
    if (legacy) b.goals = [{ id: "g-legacy", title: (s.goalTitle || "Mi meta").slice(0, 40), emoji: guessEmoji(s.goalTitle || ""), date: s.goalDate, cleared: 0, createdAt: 0 }];
    b.goals.forEach(g => { const x = splitGoalTitle(g.title, g.emoji); g.title = x.title; g.emoji = x.emoji; });
    b.goalTitle = ""; b.goalDate = "";
    const goalIds = new Set(b.goals.map(g => g.id));
    b.tasks.forEach(t => { if (t.goal && (!goalIds.has(t.goal) || t.repeat)) t.goal = ""; });
    // Las repetidas vuelven según la última vez que se hicieron (con el día que empieza a las 5).
    for (const t of b.tasks) if (t.repeat) {
      const last = Math.max(0, ...b.tasks.filter(x => x.parentId === t.id && x.done).map(x => x.doneAt || 0));
      if (last) t.nextDue = nextDueFrom(t.repeat, last);
    }
    // Recontar las tareas por día a partir de lo hecho (corrige lo marcado después de medianoche).
    const doneTs = [...b.tasks.filter(t => t.done).map(t => t.doneAt), ...b.archived.map(a => a.doneAt)].filter(Boolean);
    if (doneTs.length) {
      const counts = {};
      doneTs.forEach(ts => { const k = dayKey(new Date(ts)); counts[k] = (counts[k] || 0) + 1; });
      const firstKey = dayKey(new Date(Math.min(...doneTs)));
      const older = {};
      for (const [k, v] of Object.entries(b.days)) if (k < firstKey) older[k] = v;
      b.days = { ...older, ...counts };
    }
    return b;
  }
  const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const dateToKey = (d) => d.toLocaleDateString("sv-SE");
  const REPEATS = { daily: "cada día", every2: "cada 2 días", weekly: "cada semana" };
  const REPEAT_DAYS = { daily: 1, every2: 2, weekly: 7 };
  function nextDueFrom(repeat, now) {
    const d = logicalDate(now); d.setHours(DAY_START_HOUR, 0, 0, 0);
    d.setDate(d.getDate() + (REPEAT_DAYS[repeat] || 1));
    return d.getTime();
  }
  function mergeStates(a, b) {
    // a = este dispositivo, b = la nube. Une sin perder lo hecho en ninguno.
    const gone = new Set([...a.deleted, ...b.deleted, ...a.archived.map(x => x.id), ...b.archived.map(x => x.id)]);
    const out = normalize(clone(a));
    const byId = new Map();
    // La misma tarea en los dos lados: hecha gana a pendiente; entre ediciones, gana la más reciente.
    const pickTask = (x, y) => {
      if (!y) return x;
      if (x.done !== y.done) return x.done ? x : y;
      const w = x.done ? ((x.doneAt || 0) >= (y.doneAt || 0) ? x : y) : ((x.editedAt || 0) >= (y.editedAt || 0) ? x : y);
      return { ...w, nextDue: Math.max(x.nextDue || 0, y.nextDue || 0) };
    };
    for (const t of [...a.tasks, ...b.tasks]) byId.set(t.id, pickTask(t, byId.get(t.id)));
    out.tasks = [...byId.values()].filter(t => !gone.has(t.id));
    const doneIn = (s) => new Set(s.tasks.filter(t => t.done).map(t => t.id));
    const da = doneIn(a), db = doneIn(b);
    const onlyA = a.tasks.filter(t => t.done && !db.has(t.id)).reduce((n, t) => n + (t.earned || 0), 0);
    const onlyB = b.tasks.filter(t => t.done && !da.has(t.id)).reduce((n, t) => n + (t.earned || 0), 0);
    out.earned = Math.max(a.earned + onlyB, b.earned + onlyA);
    out.spent = Math.max(a.spent, b.spent);
    const rw = new Map(); [...b.rewards, ...a.rewards].forEach(r => rw.set(r.id, r)); out.rewards = [...rw.values()];
    const rd = new Map(); [...a.redeemed, ...b.redeemed].forEach(r => rd.set(r.at + r.text, r)); out.redeemed = [...rd.values()].sort((x, y) => x.at - y.at).slice(-100);
    out.days = { ...b.days }; for (const [k, v] of Object.entries(a.days)) out.days[k] = Math.max(v, out.days[k] || 0);
    out.badges = { ...b.badges, ...a.badges };
    const ar = new Map(); [...a.archived, ...b.archived].forEach(x => ar.set(x.id, x)); out.archived = [...ar.values()].sort((x, y) => x.doneAt - y.doneAt).slice(-70);
    out.cleared = Math.max(a.cleared, b.cleared);
    out.deleted = [...new Set([...a.deleted, ...b.deleted])].slice(-400);
    out.lastDoneAt = Math.max(a.lastDoneAt, b.lastDoneAt);
    out.lastBackup = Math.max(a.lastBackup, b.lastBackup);
    const gm = new Map();
    [...b.goals, ...a.goals].forEach(g => { const prev = gm.get(g.id); gm.set(g.id, { ...g, cleared: Math.max(g.cleared || 0, prev ? prev.cleared || 0 : 0) }); });
    out.goals = [...gm.values()].filter(g => !out.deleted.includes(g.id));
    const okGoals = new Set(out.goals.map(g => g.id));
    out.tasks.forEach(t => { if (t.goal && !okGoals.has(t.goal)) t.goal = ""; });
    out.learned = { cat: { ...b.learned.cat, ...a.learned.cat }, size: { ...b.learned.size, ...a.learned.size } };
    return out;
  }

  const api = { CATS, SIZES, REPEATS, REPEAT_DAYS, DAY_START_HOUR, HOUR, blank, uid, logicalDate, dayKey, clone, keyToDate, dateToKey,
    nextDueFrom, EMOJI_RE, splitGoalTitle, guessEmoji, normalize, mergeStates };
  root.JardinCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
