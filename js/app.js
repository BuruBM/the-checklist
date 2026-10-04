(() => {
  "use strict";
  const JC = window.JardinClassify;
  const foldN = JC.foldN;
  const classify = (text) => JC.classify(text, state.learned);
  const datesFromText = (text, out, explicit) => JC.datesFromText(text, out, explicit, keyToDate(dayKey()));
  const goalFromText = (text) => JC.goalFromText(text, sortedGoals().filter(g => (goalDays(g) ?? 0) >= 0));
  const { CATS, SIZES, REPEATS, REPEAT_DAYS, DAY_START_HOUR, HOUR, blank, uid, logicalDate, dayKey, clone, keyToDate, dateToKey, nextDueFrom, splitGoalTitle, guessEmoji, normalize, mergeStates } = window.JardinCore;

  /* ================= constants ================= */
  const LEVELS = [
    // Pensado para ~60-100 pts por día: cada nivel pide varios días de constancia, y cada vez más.
    [0, "Semilla"], [150, "Brote"], [400, "Plantín"], [750, "Flor"], [1200, "Maceta llena"],
    [1800, "Arbusto"], [2600, "Árbol joven"], [3600, "Huerto"], [4800, "Jardín"], [6300, "Bosque"], [8000, "Selva mágica"],
  ];
  const CHEERS = [
    "¡Una menos! Tu cabeza ya pesa un poquito menos.",
    "Hecho. Eso ya no tiene que vivir en tu mente.",
    "¡Bien ahí! Un paso chiquito sigue siendo un paso.",
    "Mirá tu jardín: una flor nueva gracias a vos.",
    "Lo estás haciendo mejor de lo que creés.",
    "Tachadito. Qué gusto, ¿no?",
    "Poco a poco se llega lejos. Seguí así.",
    "Tu yo del futuro te lo agradece.",
    "¡Eso! Una victoria más para hoy.",
    "Respirá. Lo lograste.",
    "Una cosa a la vez, y mirá cuánto avanzás.",
    "¡Imparable! (pero con pausas, que también cuentan).",
  ];
  const BIG_CHEERS = [
    "¡Esa era grande! Date un aplauso de verdad.",
    "Te sacaste un peso enorme de encima. ¡Enorme!",
    "La tarea difícil, hecha. Hoy sos invencible.",
  ];
  const REWARD_IDEAS = [
    ["Un café o té rico", 60], ["Un capítulo de mi serie", 80], ["Paseo sin prisa", 100],
    ["Baño largo", 150], ["Pedir mi comida favorita", 300], ["Un capricho que tengo pendiente", 500],
  ];
  const BADGES = [
    { id: "first", name: "Primer paso", desc: "Terminá tu primera tarea", color: "--petal-1" },
    { id: "dump", name: "Cabeza liviana", desc: "Volcá 5 o más cosas de una vez", color: "--petal-3" },
    { id: "big", name: "Valiente", desc: "Terminá una tarea grande", color: "--petal-5" },
    { id: "five", name: "Día productivo", desc: "5 tareas en un mismo día", color: "--petal-2" },
    { id: "clear", name: "Día despejado", desc: "Vaciá tu lista de hoy (mín. 3)", color: "--petal-4" },
    { id: "combo", name: "En racha", desc: "3 tareas seguidas en menos de 20 min", color: "--petal-1" },
    { id: "streak3", name: "Constancia", desc: "3 días seguidos avanzando", color: "--petal-3" },
    { id: "streak7", name: "Semana en flor", desc: "7 días seguidos avanzando", color: "--petal-5" },
    { id: "ten", name: "Diez flores", desc: "10 tareas terminadas", color: "--petal-2" },
    { id: "fifty", name: "Jardinera experta", desc: "50 tareas terminadas", color: "--petal-4" },
    { id: "reward", name: "Te lo ganaste", desc: "Canjeá tu primer premio", color: "--petal-1" },
    { id: "split", name: "Divide y vencerás", desc: "Dividí una tarea en pasitos", color: "--petal-3" },
  ];
  const LS_KEY = "jardin-pendientes-v1";

  /* ================= state ================= */
  let state = blank();
  let tab = "today";
  let goalFilter = (() => { try { return localStorage.getItem("jardin-goalf") || ""; } catch { return ""; } })();
  let catFilter = (() => { try { return localStorage.getItem("jardin-cat") || ""; } catch { return ""; } })();
  let addSize = "s";
  let justPlanted = null;
  let spotlight = null;
  let picking = null, pickDepth = 0;   // modo «Elegir varias»: ids elegidos y cuántos vaciados se sumaron
  let pendingRedeem = null;

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const $ = (id) => document.getElementById(id);


  /* ================= persistence ================= */
  function loadLocal() { try { const r = localStorage.getItem(LS_KEY); return r ? normalize(JSON.parse(r)) : null; } catch { return null; } }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {} }

  let ref = null, saveTimer = null, writing = false, again = false, lastRev = null;
  function persist() {
    saveLocal();
    cloudChanged();
    if (!ref) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }
  async function flush() {
    if (!ref) return;
    if (writing) { again = true; return; }
    writing = true;
    const rev = uid(); lastRev = rev;
    try { await ref.set({ state: clone(state), rev, updatedAt: Date.now() }); setSync("live"); }
    catch (e) { if (e && (e.code === "revoked" || e.code === "invalid_argument" || e.code === "not_granted")) { ref = null; setSync("local"); } }
    writing = false;
    if (again) { again = false; flush(); }
  }
  function setSync(s) {
    const el = $("sync"); el.dataset.state = s;
    el.textContent = {
      live: "Guardado en la nube", ok: "Sincronizado", syncing: "Sincronizando…",
      offline: "Sin conexión · se sube al volver", error: "No se pudo sincronizar",
    }[s] || "Guardado en este teléfono";
  }
  const forget = (id) => { if (!state.deleted.includes(id)) state.deleted.push(id); if (state.deleted.length > 400) state.deleted.splice(0, state.deleted.length - 400); };
  const unforget = (id) => { state.deleted = state.deleted.filter(x => x !== id); };

  async function connectDb() {
    if (!window.claude || !window.claude.use) return;
    let db = null;
    try { db = await window.claude.use("db"); } catch { db = null; }
    if (!db) return;
    try { ref = db.doc("boards/main"); } catch { ref = null; return; }
    let first = true;
    ref.onSnapshot((snap) => {
      if (snap.metadata && snap.metadata.hasPendingWrites) return;
      if (!snap.exists) {
        if (first && hasContent(state)) flush();
        first = false; setSync("live"); return;
      }
      const d = snap.data() || {};
      setSync("live");
      if (d.rev && d.rev === lastRev) { first = false; return; }
      state = normalize(clone(d.state));
      first = false;
      saveLocal(); render();
    }, () => { ref = null; setSync("local"); });
  }
  const hasContent = (s) => s.tasks.length || s.rewards.length || s.earned;

  async function connectSample() {
    if (!window.claude || !window.claude.use) return null;
    try { return await window.claude.use("sample"); } catch { return null; }
  }
  let sample = null;

  /* ================= derived ================= */
  function levelInfo(pts) {
    let i = 0;
    while (i + 1 < LEVELS.length && pts >= LEVELS[i + 1][0]) i++;
    const cur = LEVELS[i], next = LEVELS[i + 1];
    const pct = next ? ((pts - cur[0]) / (next[0] - cur[0])) * 100 : 100;
    return { idx: i, name: cur[1], next, pct };
  }
  function streak() {
    let n = 0; const d = new Date();
    if (!state.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (state.days[dayKey(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const isPending = (t) => !t.done && !(t.repeat && t.nextDue > Date.now());
  // Metas: cada una con su fecha; cada tarea puede pertenecer a una (o a ninguna).
  const goalById = (id) => state.goals.find(g => g.id === id) || null;
  const goalLabel = (g) => { const x = splitGoalTitle(g.title, g.emoji); return { emoji: x.emoji, title: x.title }; };
  const sortedGoals = () => [...state.goals].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  const goalRank = (t) => { const g = t.goal && goalById(t.goal); return g && g.date ? g.date : "9999"; };
  function goalDays(g) {
    if (!g || !g.date) return null;
    const today = logicalDate(); today.setHours(0, 0, 0, 0);
    return Math.round((keyToDate(g.date) - today) / 86400000);
  }
  function goalStats(g) {
    const mine = state.tasks.filter(t => t.goal === g.id && !t.repeat);
    const done = mine.filter(t => t.done).length + (g.cleared || 0);
    const pend = mine.filter(isPending).length;
    return { done, pend, total: done + pend };
  }
  const isToday = (t) => t.today || !!t.repeat || (!!t.due && t.due <= dayKey());
  function dueDiff(t) {
    if (!t.due) return null;
    return Math.round((keyToDate(t.due) - keyToDate(dayKey())) / 86400000);
  }
  function dueInfo(t) {
    const n = dueDiff(t);
    if (n === null || t.done) return null;
    const d = keyToDate(t.due);
    const short = d.toLocaleDateString("es", { day: "numeric", month: "short" });
    if (n < 0) return { cls: "over", label: n === -1 ? "Venció ayer" : `Venció el ${short}` };
    if (n === 0) return { cls: "today", label: "Vence hoy" };
    if (n === 1) return { cls: "soon", label: "Para mañana" };
    if (n < 7) return { cls: "soon", label: "Para el " + d.toLocaleDateString("es", { weekday: "long", day: "numeric" }) };
    return { cls: "later", label: `Para el ${short}` };
  }
  // Prioridad: primero lo que vence antes, después lo marcado para hoy, después la meta más próxima, después lo más rápido.
  const prio = (a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0)
    || (Number(!!b.today) - Number(!!a.today)) || goalRank(a).localeCompare(goalRank(b)) || (sizeRank(a) - sizeRank(b));
  const wallet = () => Math.max(0, state.earned - state.spent);
  const doneTasks = () => state.tasks.filter(t => t.done);

  /* ================= actions ================= */
  function addTask(text, cat, size, today, repeat, due, goal) {
    text = text.trim(); if (!text) return null;
    const t = { id: uid(), text: text.slice(0, 200), cat: CATS[cat] ? cat : "otros", size: SIZES[size] ? size : "m", today: !!today, done: false, doneAt: 0, createdAt: Date.now(),
      repeat: REPEATS[repeat] ? repeat : "", nextDue: 0, parentId: "", due: repeat ? "" : (due || ""),
      goal: !repeat && goal && goalById(goal) ? goal : "" };
    state.tasks.push(t); return t;
  }

  function complete(t, originEl) {
    if (t.done) return;
    const now = Date.now();
    if (t.repeat) {
      // La tarea repetida vuelve a aparecer mañana (o en una semana); lo hecho queda como flor.
      const inst = { id: uid(), text: t.text, cat: t.cat, size: t.size, today: true, done: false, doneAt: 0, createdAt: now, repeat: "", nextDue: 0, parentId: t.id };
      t.nextDue = nextDueFrom(t.repeat, now);
      state.tasks.push(inst);
      t = inst;
    }
    t.done = true; t.doneAt = now;
    let pts = SIZES[t.size].pts;
    let bonus = 0;
    if (now - state.lastDoneAt < 20 * 60 * 1000) { state.comboCount++; } else { state.comboCount = 1; }
    if (state.comboCount >= 2) bonus = 5 * Math.min(state.comboCount - 1, 4);
    if (t.today) bonus += 5;
    state.lastDoneAt = now;
    t.earned = pts + bonus;
    const beforeLvl = levelInfo(state.earned).idx;
    state.earned += t.earned;
    const k = dayKey(); state.days[k] = (state.days[k] || 0) + 1;
    justPlanted = t.id;

    const msg = t.size === "l" ? pick(BIG_CHEERS) : pick(CHEERS);
    const extra = state.comboCount >= 2 ? ` · combo x${state.comboCount}` : "";
    toast(msg, `+${t.earned}${extra}`);
    burst(originEl, t.size === "l" ? 90 : 45);
    chime(t.size === "l" ? 3 : 2);

    checkBadges(t);
    const afterLvl = levelInfo(state.earned).idx;
    persist(); render();
    if (afterLvl > beforeLvl) setTimeout(() => levelUp(LEVELS[afterLvl][1]), 500);
  }

  function uncomplete(t) {
    if (!t.done) return;
    state.earned = Math.max(0, state.earned - (t.earned || SIZES[t.size].pts));
    const k = dayKey(new Date(t.doneAt));
    if (state.days[k]) state.days[k]--;
    t.done = false; t.doneAt = 0; t.earned = 0;
    if (t.parentId) {
      const parent = state.tasks.find(x => x.id === t.parentId);
      state.tasks.splice(state.tasks.indexOf(t), 1);
      forget(t.id);
      if (parent) parent.nextDue = 0;
    }
    persist(); render();
  }

  function remove(t) {
    const idx = state.tasks.indexOf(t);
    if (idx < 0) return;
    state.tasks.splice(idx, 1);
    forget(t.id);
    persist(); render();
    toast("Tarea borrada.", "", { label: "Deshacer", fn: () => { unforget(t.id); state.tasks.splice(Math.min(idx, state.tasks.length), 0, t); persist(); render(); } });
  }

  // Borra varias de una; el aviso deja deshacerlo
  function removeMany(list, withToast = true) {
    const gone = list.map(t => ({ t, idx: state.tasks.indexOf(t) })).filter(x => x.idx >= 0).sort((a, b) => b.idx - a.idx);
    if (!gone.length) return;
    gone.forEach(({ t, idx }) => { state.tasks.splice(idx, 1); forget(t.id); });
    persist(); render();
    if (withToast) toast(gone.length === 1 ? "1 tarea borrada." : `${gone.length} tareas borradas.`, "", { label: "Deshacer", fn: () => {
      [...gone].reverse().forEach(({ t, idx }) => { unforget(t.id); state.tasks.splice(Math.min(idx, state.tasks.length), 0, t); });
      persist(); render();
    } });
  }

  function unlock(id) {
    if (state.badges[id]) return false;
    state.badges[id] = Date.now();
    const b = BADGES.find(x => x.id === id);
    setTimeout(() => { toast(`Logro desbloqueado: ${b.name}`, "★", null, "badge-toast"); chime(4); }, 700);
    return true;
  }

  function checkBadges(t) {
    const done = state.cleared + doneTasks().length;
    if (done >= 1) unlock("first");
    if (done >= 10) unlock("ten");
    if (done >= 50) unlock("fifty");
    if (t && t.size === "l") unlock("big");
    if ((state.days[dayKey()] || 0) >= 5) unlock("five");
    if (state.comboCount >= 3) unlock("combo");
    const s = streak();
    if (s >= 3) unlock("streak3");
    if (s >= 7) unlock("streak7");
    const todayAll = state.tasks.filter(x => x.today);
    if (todayAll.length >= 3 && todayAll.every(x => x.done)) unlock("clear");
  }

  function redeem(r) {
    if (wallet() < r.cost) return;
    state.spent += r.cost;
    state.redeemed.push({ text: r.text, cost: r.cost, at: Date.now() });
    unlock("reward");
    persist(); render();
    celebrate(`¡Disfrutá: ${r.text}!`, "Te lo ganaste tarea a tarea. Descansar también es parte del plan.");
    burst(null, 120); chime(5);
  }

  /* ================= rendering ================= */
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) e.append(kid);
    return e;
  }
  const ICONS = {
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    split: '<path d="M5 5h6M5 12h9M5 19h14"/><circle cx="16" cy="5" r="1.4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  function svgIcon(name) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = ICONS[name]; return s; }

  function pickRow(t) {
    const on = picking.has(t.id);
    const li = el("li", { class: "task picking" + (on ? " picked" : "") + (t.done ? " done" : ""), "data-id": t.id });
    const toggle = () => { on ? picking.delete(t.id) : picking.add(t.id); render(); };
    const chk = el("button", { class: "check", type: "button", "aria-label": "Elegir", "aria-pressed": on ? "true" : "false", onclick: toggle });
    chk.append(svgIcon("check"));
    const c = CATS[t.cat];
    const body = el("div", { class: "tbody", role: "button", tabindex: "0", onclick: toggle, onkeydown: (e) => { if (e.key === "Enter") toggle(); } },
      el("div", { class: "ttext", text: t.text }),
      el("div", { class: "meta" }, el("span", { class: "cat" }, el("i", { class: "dot", style: `background:${c.color}` }), c.label)));
    li.append(chk, body, el("span"));
    return li;
  }
  // Tandas de tareas cargadas juntas (un «Agregar todo»), de la más nueva a la más vieja
  function dumpBatches() {
    const ts = state.tasks.filter(t => !t.parentId && t.createdAt).sort((a, b) => b.createdAt - a.createdAt);
    const out = [];
    let cur = [];
    for (const t of ts) {
      if (cur.length && cur[cur.length - 1].createdAt - t.createdAt > 3000) { out.push(cur); cur = []; }
      cur.push(t);
    }
    if (cur.length) out.push(cur);
    return out.filter(b => b.length >= 2);
  }
  function pickBar() {
    const n = picking.size;
    const batches = dumpBatches();
    const bar = el("div", { class: "pick-bar", role: "toolbar", "aria-label": "Elegir varias" },
      el("span", { class: "pick-count", text: n === 1 ? "1 elegida" : `${n} elegidas` }));
    if (pickDepth < batches.length) bar.append(el("button", { class: "btn small", type: "button", id: "pick-batch",
      text: pickDepth ? "+ el vaciado anterior" : "Último vaciado", onclick: () => {
        batches[pickDepth].forEach(t => picking.add(t.id)); pickDepth++;
        if (tab !== "all" && tab !== "done") { tab = "all"; catFilter = ""; goalFilter = ""; }
        render();
      } }));
    bar.append(...[
      el("button", { class: "btn small", type: "button", id: "pick-all", text: "Todas las que se ven", onclick: () => {
        $("list").querySelectorAll(".task[data-id]").forEach(li => picking.add(li.dataset.id)); render();
      } }),
      n ? el("button", { class: "btn small", type: "button", text: "Ninguna", onclick: () => { picking.clear(); pickDepth = 0; render(); } }) : null,
      el("button", { class: "btn small danger", type: "button", id: "pick-delete", disabled: !n, text: n ? `Borrar ${n}` : "Borrar", onclick: () => {
        const list = state.tasks.filter(t => picking.has(t.id));
        setPicking(false); removeMany(list);
      } }),
      el("button", { class: "btn small", type: "button", text: "Listo", onclick: () => setPicking(false) })].filter(Boolean));
    return bar;
  }
  function setPicking(on) {
    picking = on ? new Set() : null; pickDepth = 0;
    $("pick-btn").setAttribute("aria-pressed", on ? "true" : "false");
    $("pick-btn").textContent = on ? "Cancelar" : "Elegir varias";
    render();
  }

  function taskRow(t) {
    if (picking && t.id !== "ex") return pickRow(t);
    const li = el("li", { class: "task" + (t.done ? " done" : "") + (spotlight === t.id ? " spot" : ""), "data-id": t.id });
    const chk = el("button", { class: "check", type: "button", "aria-label": t.done ? "Marcar como pendiente" : "Marcar como hecha", "aria-pressed": t.done ? "true" : "false" });
    chk.append(svgIcon("check"));
    chk.addEventListener("click", () => t.done ? uncomplete(t) : complete(t, chk));
    const c = CATS[t.cat];
    const meta = el("div", { class: "meta" },
      el("span", { class: "cat" }, el("i", { class: "dot", style: `background:${c.color}` }), c.label),
      el("span", { title: SIZES[t.size].label }, el("span", { class: "seeds", text: SIZES[t.size].seeds }), " " + SIZES[t.size].label),
      el("span", { class: "pts num", text: t.done ? `+${t.earned || SIZES[t.size].pts} pts` : `${SIZES[t.size].pts} pts` }),
      t.repeat ? el("span", { class: "rep", text: `↻ ${REPEATS[t.repeat]}` + (t.notifyAt ? ` · 🔔 ${t.notifyAt}` : "") }) : null,
      t.goal && goalFilter !== t.goal && goalById(t.goal) ? el("span", { class: "goal-chip", text: `${goalLabel(goalById(t.goal)).emoji} ${goalLabel(goalById(t.goal)).title}` }) : null,
    );
    const di = dueInfo(t);
    if (di) meta.prepend(el("span", { class: "due " + di.cls, text: di.label }));
    const body = el("div", { class: "tbody", role: "button", tabindex: "0", title: "Editar" }, el("div", { class: "ttext", text: t.text }), meta);
    if (t.id !== "ex") {
      body.addEventListener("click", () => openEditor(t));
      body.addEventListener("keydown", (e) => { if (e.key === "Enter") openEditor(t); });
    }
    const acts = el("div", { class: "tactions" });
    if (!t.done && !t.repeat) {
      const star = el("button", { class: "icon" + (t.today ? " on" : ""), type: "button", "aria-label": t.today ? "Quitar de hoy" : "Para hoy", title: t.today ? "Quitar de hoy" : "Para hoy (+5 pts)" });
      star.append(svgIcon("star"));
      star.addEventListener("click", () => { t.today = !t.today; t.editedAt = Date.now(); persist(); render(); });
      acts.append(star);
    }
    if (!t.done) {
      if (sample && t.size !== "s") {
        const sp = el("button", { class: "icon", type: "button", "aria-label": "Dividir en pasitos con Claude", title: "Dividir en pasitos (Claude)" });
        sp.append(svgIcon("split"));
        sp.addEventListener("click", () => splitTask(t, li));
        acts.append(sp);
      }
    }
    const ed = el("button", { class: "icon", type: "button", "aria-label": "Editar", title: "Editar" });
    ed.append(svgIcon("edit"));
    ed.addEventListener("click", () => openEditor(t));
    acts.append(ed);
    li.append(chk, body, acts);
    return li;
  }

  function renderCats(base) {
    const box = $("cats"); box.replaceChildren();
    if (!state.tasks.length) { box.hidden = true; return; }
    box.hidden = false;
    const chip = (key, label, n, color) => {
      const b = el("button", { class: "catchip", type: "button", "aria-pressed": catFilter === key ? "true" : "false" },
        color ? el("i", { class: "dot", style: `background:${color}` }) : null, label, el("span", { class: "n", text: String(n) }));
      b.addEventListener("click", () => setCat(catFilter === key ? "" : key));
      return b;
    };
    if (goalFilter) {
      const g = goalById(goalFilter);
      const gb = el("button", { class: "catchip", type: "button", "aria-pressed": "true", title: "Dejar de filtrar por meta" },
        goalFilter === "none" ? "Sin meta" : `${g ? goalLabel(g).emoji + " " + goalLabel(g).title : "Meta"}`, el("span", { class: "n", text: "✕" }));
      gb.addEventListener("click", () => setGoalFilter(""));
      box.append(gb);
    }
    box.append(chip("", "Todas", base.length));
    for (const [key, c] of Object.entries(CATS)) {
      const n = base.filter(t => t.cat === key).length;
      if (n || catFilter === key) box.append(chip(key, c.label, n, c.color));
    }
  }
  function setCat(key) {
    catFilter = key; spotlight = null;
    try { localStorage.setItem("jardin-cat", key); } catch {}
    if (key) { catSel.value = key; updateAddHint(); }
    render();
  }

  function renderList() {
    const root = $("list"); root.replaceChildren();
    const allPending = state.tasks.filter(isPending);
    const allToday = allPending.filter(isToday);
    const allDone = doneTasks().sort((a, b) => b.doneAt - a.doneAt);
    if (goalFilter && goalFilter !== "none" && !goalById(goalFilter)) goalFilter = "";
    const inGoal = (t) => !goalFilter || (goalFilter === "none" ? !t.goal : t.goal === goalFilter);
    renderCats((tab === "today" ? allToday : tab === "done" ? allDone : tab === "dates" ? allPending.filter(t => !t.repeat) : allPending).filter(inGoal));
    const inCat = (t) => (!catFilter || t.cat === catFilter) && inGoal(t);
    const pending = allPending.filter(inCat);
    const today = allToday.filter(inCat);
    const done = allDone.filter(inCat);
    $("c-today").textContent = today.length;
    $("c-all").textContent = pending.length;
    $("c-done").textContent = done.length;
    $("c-dates").textContent = pending.filter(t => t.due).length;

    if (picking) root.append(pickBar());
    const info = goalInfoBar();
    if (info) root.append(info);
    if (!state.tasks.length) {
      root.append(el("div", { class: "empty" }, el("strong", { text: "Tu lista está vacía (y eso está bien)." }),
        el("span", { text: "Usá «Vaciar la cabeza» para soltar todo de golpe, o escribí una tarea arriba." }),
        el("button", { class: "btn primary small", type: "button", style: "justify-self:center", text: "Vaciar la cabeza", onclick: () => {
          $("dump").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); setTimeout(() => $("dump-text").focus(), 350);
        } })));
      const ex = el("ul", { class: "list examples", "aria-label": "Ejemplo" });
      ex.append(el("li", { class: "tag", text: "Así se verá · ejemplo" }));
      [["Llamar para pedir turno médico", "salud", "s"], ["Terminar la presentación", "trabajo", "l"], ["Comprar regalo de cumpleaños", "recados", "m"]]
        .forEach(([text, cat, size]) => { const r = taskRow({ id: "ex", text, cat, size, today: false, done: false }); r.querySelectorAll("button").forEach(b => b.disabled = true); ex.append(r); });
      root.append(ex);
      return;
    }

    if (tab === "today") {
      if (!today.length) {
        root.append(el("div", { class: "empty" },
          el("strong", { text: pending.length ? "Aún no elegiste nada para hoy." : "¡No te queda nada pendiente!" }),
          el("span", { text: pending.length ? "Marcá con la estrella 2 o 3 cosas para hoy. Mejor pocas y hechas que muchas y pesadas." : "Disfrutá tu jardín. Te lo ganaste." })));
        if (pending.length) {
          const g = el("ul", { class: "list" });
          [...pending].sort(prio).slice(0, 4).forEach(t => g.append(taskRow(t)));
          root.append(el("div", { class: "group-title", text: "Sugerencias rápidas para empezar" }), g);
        }
      } else {
        const g = el("ul", { class: "list" });
        today.sort(prio).forEach(t => g.append(taskRow(t)));
        const doneToday = done.filter(t => dayKey(new Date(t.doneAt)) === dayKey());
        root.append(g);
        if (doneToday.length) {
          const g2 = el("ul", { class: "list" }); doneToday.forEach(t => g2.append(taskRow(t)));
          root.append(el("div", { class: "group-title", text: `Ya hechas hoy · ${doneToday.length}` }), g2);
        }
      }
    } else if (tab === "dates") {
      const groups = [["Vencidas", n => n < 0], ["Hoy", n => n === 0], ["Mañana", n => n === 1], ["Esta semana", n => n > 1 && n < 7], ["Más adelante", n => n >= 7]];
      const once = pending.filter(t => !t.repeat).sort(prio);
      if (!once.some(t => t.due)) root.append(el("div", { class: "empty" }, el("strong", { text: "Todavía no pusiste fechas." }),
        el("span", { text: "Tocá una tarea para editarla y ponerle para cuándo la necesitás. Acá se ordenan solas por urgencia." })));
      for (const [label, test] of groups) {
        const items = once.filter(t => t.due && test(dueDiff(t)));
        if (!items.length) continue;
        const g = el("ul", { class: "list" }); items.forEach(t => g.append(taskRow(t)));
        root.append(el("div", { class: "group" }, el("div", { class: "group-title" + (label === "Vencidas" ? " over" : ""), text: `${label} · ${items.length}` }), g));
      }
      const nodate = once.filter(t => !t.due);
      if (nodate.length) {
        const g = el("ul", { class: "list" }); nodate.forEach(t => g.append(taskRow(t)));
        root.append(el("div", { class: "group" }, el("div", { class: "group-title", text: `Sin fecha · ${nodate.length}` }), g));
      }
    } else if (tab === "all") {
      const waiting = state.tasks.filter(t => t.repeat && !isPending(t) && inCat(t));
      if (!pending.length) root.append(el("div", { class: "empty" }, el("strong", { text: "¡Todo hecho!" }), el("span", { text: "No queda nada pendiente. Qué alivio." })));
      for (const [key, c] of Object.entries(CATS)) {
        const items = pending.filter(t => t.cat === key).sort(prio);
        if (!items.length) continue;
        const g = el("ul", { class: "list" }); items.forEach(t => g.append(taskRow(t)));
        root.append(el("div", { class: "group" },
          el("div", { class: "group-title" }, el("i", { class: "dot", style: `background:${c.color}` }), `${c.label} · ${items.length}`), g));
      }
      if (waiting.length) {
        const g = el("ul", { class: "list" });
        waiting.forEach(t => {
          const d = new Date(t.nextDue);
          const when = dayKey(d) === dayKey(new Date(Date.now() + 86400000)) ? "mañana" : d.toLocaleDateString("es", { weekday: "long", day: "numeric" });
          g.append(el("li", { class: "task waiting" }, el("span", { class: "rep", text: "✓" }), el("div", { class: "tbody" },
            el("div", { class: "ttext", text: t.text }), el("div", { class: "meta", text: `Hecha. Vuelve ${when}.` })), el("span")));
        });
        root.append(el("div", { class: "group" }, el("div", { class: "group-title", text: "Tareas repetidas ya hechas" }), g));
      }
    } else {
      if (!done.length) root.append(el("div", { class: "empty" }, el("strong", { text: "Acá vas a ver todo lo que ya lograste." }), el("span", { text: "Tu primera tarea terminada está a un clic." })));
      const g = el("ul", { class: "list" }); done.slice(0, 80).forEach(t => g.append(taskRow(t)));
      root.append(g);
      if (done.length) {
        root.append(el("div", { class: "row" }, el("button", { class: "btn small", type: "button", text: "Limpiar las hechas de la lista (las flores se quedan)", onclick: () => {
          const gone = doneTasks(); state.cleared += gone.length;
          gone.forEach(t => { const g = t.goal && goalById(t.goal); if (g && !t.repeat) g.cleared = (g.cleared || 0) + 1; }); state.archived = state.archived.concat(gone.map(t => ({ id: t.id, size: t.size, doneAt: t.doneAt }))).slice(-70); state.tasks = state.tasks.filter(t => !t.done); persist(); render();
        } })));
      }
    }
  }
  const sizeRank = (t) => ({ s: 0, m: 1, l: 2 })[t.size];

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function renderGarden() {
    const svg = $("garden");
    const list = state.archived.concat(doneTasks()).sort((a, b) => a.doneAt - b.doneAt);
    const total = state.cleared + doneTasks().length;
    const shown = list.slice(-70);
    let out = `<rect class="soil" x="0" y="148" width="800" height="22"/><path class="soil2" d="M0 152 Q 100 146 200 152 T 400 152 T 600 152 T 800 152 V170 H0Z"/>`;
    if (!shown.length) {
      for (let i = 0; i < 9; i++) { const x = 60 + i * 85; out += `<ellipse class="sprout" cx="${x}" cy="147" rx="5" ry="2.5"/>`; }
      out += `<text class="emptytxt" x="400" y="80" text-anchor="middle">Cada tarea terminada planta una flor acá</text>`;
    }
    shown.forEach((t, i) => {
      const h = hash(t.id);
      const n = shown.length;
      const slot = n <= 1 ? 400 : 30 + (i / (n - 1)) * 740;
      const x = Math.round(Math.max(18, Math.min(782, slot + ((h % 30) - 15))));
      const height = { s: 34, m: 56, l: 82 }[t.size] + (h % 14);
      const sway = ((h >> 3) % 17) - 8;
      const top = 148 - height, tx = x + sway;
      const pc = "p" + (1 + (h % 5));
      const r = { s: 5, m: 7, l: 9 }[t.size];
      const petals = t.size === "l" ? 8 : 5 + ((h >> 5) % 2);
      let head = "";
      for (let p = 0; p < petals; p++) {
        const a = (p / petals) * Math.PI * 2 + (h % 10) / 10;
        head += `<circle class="${pc}" cx="${(tx + Math.cos(a) * r * 1.05).toFixed(1)}" cy="${(top + Math.sin(a) * r * 1.05).toFixed(1)}" r="${r * .78}"/>`;
      }
      head += `<circle class="ctr" cx="${tx}" cy="${top}" r="${r * .62}"/>`;
      const lx = x + sway * .4, ly = 148 - height * .45, side = (h & 1) ? 1 : -1;
      const leaf = `<ellipse class="leafshape" cx="${lx + side * 7}" cy="${ly}" rx="7" ry="3" transform="rotate(${side * -30} ${lx + side * 7} ${ly})"/>`;
      const cls = t.id === justPlanted ? "new" : "";
      out += `<g class="${cls}"><path class="stem" d="M${x} 149 Q ${x + sway * .2} ${148 - height / 2} ${tx} ${top}"/>${leaf}${head}</g>`;
    });
    svg.innerHTML = out;
    $("st-flowers").textContent = total;
    justPlanted = null;
  }

  function goalSummary(g) {
    const left = goalDays(g), st = goalStats(g);
    const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    let short, when, note;
    if (left === null) { short = "—"; when = "sin fecha"; note = st.pend ? `${st.pend} por hacer` : "Todo listo"; }
    else if (left > 1) { const per = Math.ceil(st.pend / Math.max(1, left - 1)); short = `${left}d`; when = `faltan ${left} días`; note = st.pend ? `${st.pend} por hacer · con ${per} por día llegás holgada` : "¡Ya tenés todo listo!"; }
    else if (left === 1) { short = "mañana"; when = "¡es mañana!"; note = st.pend ? `${st.pend} por hacer · lo que no llegue, puede esperar` : "Todo listo. A disfrutar."; }
    else if (left === 0) { short = "hoy"; when = "¡es hoy!"; note = "Disfrutá. Lo que hiciste ya está hecho."; }
    else { short = "terminó"; when = "terminó"; note = "Tocá para cerrarla"; }
    return { left, st, pct, short, when, note, past: left !== null && left < 0 };
  }

  // Encabezado: la meta más próxima a todo el ancho (motiva); las demás, chiquitas debajo.
  function renderGoals() {
    const box = $("goals"); box.replaceChildren();
    const goals = sortedGoals();
    const hero = goals.find(g => (goalDays(g) ?? 0) >= 0) || goals[0];
    if (hero) {
      const m = goalSummary(hero);
      const when = m.left === null ? el("span", { class: "gh-when", text: "sin fecha" })
        : m.left > 1 ? el("span", { class: "gh-when" }, el("b", { class: "num", text: String(m.left) }), " días")
        : el("span", { class: "gh-when" }, el("b", { text: m.short === "terminó" ? "terminó" : `¡${m.short}!` }));
      const card = el("button", { class: "goal-hero" + (goalFilter === hero.id ? " on" : "") + (m.past ? " past" : ""), type: "button",
        "aria-pressed": goalFilter === hero.id ? "true" : "false", title: m.past ? "Cerrar esta meta" : "Ver solo las tareas de esta meta" },
        el("span", { class: "gh-emoji", text: goalLabel(hero).emoji }), el("span", { class: "gh-title", text: goalLabel(hero).title }), when,
        el("span", { class: "gh-bar" }, el("i", { style: `width:${m.pct}%` })),
        el("span", { class: "gh-count num", text: m.past ? "tocá para cerrarla" : `${m.st.done}/${m.st.total}` }));
      card.addEventListener("click", () => m.past ? openGoalClose(hero) : setGoalFilter(goalFilter === hero.id ? "" : hero.id));
      box.append(card);
    }
    const row = el("div", { class: "goal-row" });
    for (const g of goals) {
      if (g === hero) continue;
      const m = goalSummary(g);
      const chip = el("button", { class: "goal-pill" + (goalFilter === g.id ? " on" : "") + (m.past ? " past" : ""), type: "button",
        "aria-pressed": goalFilter === g.id ? "true" : "false", title: m.past ? "Cerrar esta meta" : `${g.title}: ${m.when} · ${m.st.done}/${m.st.total} hechas` },
        el("i", { class: "goal-fill", style: `width:${m.pct}%` }),
        el("span", { class: "goal-pill-name", text: `${goalLabel(g).emoji} ${goalLabel(g).title}` }), el("b", { class: "num", text: m.short }));
      chip.addEventListener("click", () => m.past ? openGoalClose(g) : setGoalFilter(goalFilter === g.id ? "" : g.id));
      row.append(chip);
    }
    const noGoal = state.tasks.filter(t => isPending(t) && !t.repeat && !t.goal).length;
    if (goals.length && noGoal) {
      row.append(el("button", { class: "goal-pill plain" + (goalFilter === "none" ? " on" : ""), type: "button", "aria-pressed": goalFilter === "none" ? "true" : "false",
        text: `Sin meta · ${noGoal}`, onclick: () => setGoalFilter(goalFilter === "none" ? "" : "none") }));
    }
    row.append(el("button", { class: "goal-pill plain add", type: "button", "aria-label": "Nueva meta",
      text: goals.length ? "+ Meta" : "+ Poner una meta con fecha (viaje, estudio, entrega…)", onclick: () => openGoalEditor(null) }));
    box.append(row);
  }

  // Franja arriba de la lista con el detalle de la meta elegida.
  function goalInfoBar() {
    const g = goalFilter && goalFilter !== "none" ? goalById(goalFilter) : null;
    if (!g) return null;
    const m = goalSummary(g);
    const ed = el("button", { class: "chip", type: "button", text: "✏️ Editar", onclick: () => openGoalEditor(g) });
    return el("div", { class: "goal-info" },
      el("div", { class: "goal-info-top" }, el("strong", { text: `${goalLabel(g).emoji} ${goalLabel(g).title}` }), el("b", { class: "goal-when num", text: m.when }), ed),
      el("div", { class: "goal-bar" }, el("i", { style: `width:${m.pct}%` })),
      el("div", { class: "goal-note" }, el("span", { text: m.note }), el("span", { class: "num", text: `${m.st.done}/${m.st.total} hechas` })));
  }

  function setGoalFilter(id) {
    goalFilter = id; spotlight = null;
    try { localStorage.setItem("jardin-goalf", id); } catch {}
    if (id && id !== "none") setDefaultGoal(id);
    render();
    if (id) {
      const g = goalById(id);
      toast(id === "none" ? "Mostrando las tareas sin meta." : `Mostrando solo ${goalLabel(g).emoji} ${goalLabel(g).title}. Lo que agregues va a esta meta.`, "");
    }
  }

  // Meta por defecto para lo que se agrega (carga rápida y «Vaciar la cabeza»).
  function defaultGoal() {
    let v = ""; try { v = localStorage.getItem("jardin-goal-default") || ""; } catch {}
    if (v === "" && state.goals.length === 1 && (goalDays(state.goals[0]) ?? 0) >= 0) v = state.goals[0].id;
    const g = goalById(v);
    return g && (goalDays(g) ?? 0) >= 0 ? v : "";
  }
  function setDefaultGoal(id) { try { localStorage.setItem("jardin-goal-default", id || "-"); } catch {} renderGoalSelects(); }
  function renderGoalSelects() {
    const cur = defaultGoal();
    for (const id of ["add-goal", "dump-goal"]) {
      const sel = $(id); if (!sel) continue;
      sel.replaceChildren(el("option", { value: "", text: "Sin meta" }));
      sortedGoals().filter(g => (goalDays(g) ?? 0) >= 0).forEach(g => sel.append(el("option", { value: g.id, text: `${goalLabel(g).emoji} ${goalLabel(g).title}` })));
      sel.value = cur;
      sel.closest("label").hidden = !state.goals.length;
    }
    if (typeof updateAddHint === "function") updateAddHint();
  }

  const GOAL_EMOJIS = ["🏖️", "✈️", "🩺", "🏠", "💼", "🎓", "🎉", "🐱", "💪", "🎯"];
  function openGoalEditor(g) {
    const isNew = !g;
    const o = el("div", { class: "overlay sheet-wrap", onclick: (e) => { if (e.target === o) close(); } });
    const close = () => { o.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    let emoji = g ? g.emoji : "🎯";
    const title = el("input", { type: "text", id: "goal-title", maxlength: "40", placeholder: "¿Qué se viene? (ej: La Playa, estudio médico)", "aria-label": "Nombre de la meta" });
    title.value = g ? g.title : "";
    const date = el("input", { type: "date", id: "goal-date", "aria-label": "Fecha" }); date.value = g ? g.date : "";
    const pick = el("div", { class: "emoji-pick", role: "group", "aria-label": "Ícono" });
    GOAL_EMOJIS.forEach(em => {
      const b = el("button", { type: "button", "aria-pressed": em === emoji ? "true" : "false", text: em, "aria-label": em });
      b.addEventListener("click", () => { emoji = em; pick.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
      pick.append(b);
    });
    if (isNew) title.addEventListener("input", () => {
      const guess = guessEmoji(title.value);
      if (guess !== "🎯") { emoji = guess; pick.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x.textContent === guess ? "true" : "false")); }
    });
    const msg = el("p", { class: "data-note", role: "status" });
    const save = () => {
      const split = splitGoalTitle(title.value, emoji);
      const t = split.title; if (split.emoji !== emoji) emoji = split.emoji;
      if (!t) { title.focus(); msg.textContent = "Ponele un nombre a la meta."; return; }
      if (!date.value) { date.focus(); msg.textContent = "Elegí la fecha de la meta."; return; }
      if (isNew) {
        const ng = { id: "g" + uid(), title: t.slice(0, 40), emoji, date: date.value, cleared: 0, createdAt: Date.now() };
        state.goals.push(ng);
        setDefaultGoal(ng.id);
        toast(`Meta creada: ${emoji} ${ng.title}. Asignale tareas desde la ficha de cada una, o elegila al cargar.`, "");
      } else {
        g.title = t.slice(0, 40); g.emoji = emoji; g.date = date.value;
        toast("Meta actualizada.", "");
      }
      persist(); render(); close();
    };
    let confirmDel = false;
    const delBtn = el("button", { class: "btn small danger", type: "button", text: "Borrar meta" });
    delBtn.addEventListener("click", () => {
      if (!confirmDel) { confirmDel = true; delBtn.textContent = "¿Seguro? Tocá de nuevo"; msg.textContent = "Las tareas de esta meta no se borran: quedan sin meta."; return; }
      removeGoal(g, "none"); close();
      toast("Meta borrada. Sus tareas quedaron sin meta.", "");
    });
    const card = el("form", { class: "card sheet", role: "dialog", "aria-modal": "true", "aria-label": isNew ? "Nueva meta" : "Editar meta", onsubmit: (e) => { e.preventDefault(); save(); } },
      el("div", { class: "sheet-head" }, el("h3", { text: isNew ? "Nueva meta" : "Editar meta" }), el("button", { class: "icon", type: "button", "aria-label": "Cerrar", text: "✕", onclick: close })),
      el("div", { class: "field" }, el("span", { class: "flabel", text: "Nombre" }), title),
      el("div", { class: "field" }, el("span", { class: "flabel", text: "¿Para cuándo?" }), date),
      el("div", { class: "field" }, el("span", { class: "flabel", text: "Ícono" }), pick),
      msg,
      el("div", { class: "row sheet-actions" }, isNew ? el("span") : delBtn, el("button", { class: "btn primary", type: "submit", text: isNew ? "Crear meta" : "Guardar" })));
    o.append(card);
    document.body.append(o);
    if (isNew) title.focus();
  }

  // Sacar una meta. Lo pendiente: "none" (queda sin meta), "delete" (se borra) u otra meta (se pasa).
  function removeGoal(g, pendingTo) {
    for (const t of [...state.tasks]) {
      if (t.goal !== g.id) continue;
      if (t.done || pendingTo === "none") t.goal = "";
      else if (pendingTo === "delete") { state.tasks.splice(state.tasks.indexOf(t), 1); forget(t.id); }
      else t.goal = goalById(pendingTo) ? pendingTo : "";
    }
    state.goals = state.goals.filter(x => x !== g);
    forget(g.id);
    if (goalFilter === g.id) { goalFilter = ""; try { localStorage.setItem("jardin-goalf", ""); } catch {} }
    persist(); render();
  }

  function openGoalClose(g) {
    const st = goalStats(g);
    const o = el("div", { class: "overlay sheet-wrap", onclick: (e) => { if (e.target === o) close(); } });
    const close = () => o.remove();
    const dest = el("select", { id: "goal-leftover", "aria-label": "Qué hacer con lo que quedó" });
    sortedGoals().filter(x => x !== g && (goalDays(x) ?? 0) >= 0).forEach(x => dest.append(el("option", { value: x.id, text: `Pasarlas a ${goalLabel(x).emoji} ${goalLabel(x).title}` })));
    dest.append(el("option", { value: "none", text: "Dejarlas sin meta" }), el("option", { value: "delete", text: "Borrarlas" }));
    dest.value = "none";
    const card = el("div", { class: "card sheet", role: "dialog", "aria-modal": "true", "aria-label": "Cerrar meta" },
      el("div", { class: "sheet-head" }, el("h3", { text: `${goalLabel(g).emoji} ${goalLabel(g).title} terminó` }), el("button", { class: "icon", type: "button", "aria-label": "Cerrar", text: "✕", onclick: close })),
      el("p", { text: st.total ? `Hiciste ${st.done} de ${st.total} tareas para esta meta. ${st.done >= st.total ? "¡Todas! 🎉" : "Todo lo que hiciste, suma."}` : "Esta meta no tenía tareas." }),
      st.pend ? el("div", { class: "field" }, el("span", { class: "flabel", text: st.pend === 1 ? "Quedó 1 sin hacer. ¿Qué hacemos con ella?" : `Quedaron ${st.pend} sin hacer. ¿Qué hacemos con ellas?` }), dest) : null,
      el("div", { class: "row sheet-actions" }, el("button", { class: "btn small", type: "button", text: "Ahora no", onclick: close }),
        el("button", { class: "btn primary", type: "button", text: "Cerrar meta", onclick: () => {
          close(); removeGoal(g, st.pend ? dest.value : "none");
          toast(`${goalLabel(g).emoji} ${goalLabel(g).title}: cerrada. ¡A la próxima!`, "");
          if (st.done) { burst(null, 100); chime(4); }
        } })));
    o.append(card);
    document.body.append(o);
    if (st.done) { burst(null, 80); chime(3); }
  }

  function renderStats() {
    const L = levelInfo(state.earned);
    $("lvl-name").textContent = L.name;
    $("lvl-bar").style.width = Math.min(100, L.pct).toFixed(1) + "%";
    $("lvl-next").textContent = L.next ? `${state.earned} / ${L.next[0]} pts → ${L.next[1]}` : `${state.earned} pts · nivel máximo`;
    $("st-today").textContent = state.days[dayKey()] || 0;
    $("st-streak").textContent = streak();
    $("wallet").textContent = wallet();
    const pending = state.tasks.filter(t => isPending(t) && !t.repeat).length;
    const reps = state.tasks.filter(t => t.repeat).length;
    const repsTxt = reps ? ` (más ${reps} ${reps === 1 ? "que se repite" : "que se repiten"})` : "";
    const doneToday = state.days[dayKey()] || 0;
    let lede;
    if (!state.tasks.length) lede = "Cada tarea que terminás planta una flor. Sacá las cosas de tu cabeza, elegí una chiquita y empezá por ahí.";
    else if (!pending) lede = "No queda nada pendiente" + (reps ? ", solo lo que se repite." : ".") + " Tu cabeza puede descansar. De verdad.";
    else if (doneToday === 0) lede = `Tenés ${pending} ${pending === 1 ? "cosa por hacer" : "cosas por hacer"}${repsTxt}. Ya no tienen que vivir en tu cabeza. Empezá por una rapidita.`;
    else lede = `Llevás ${doneToday} hoy y te ${pending === 1 ? "queda 1 cosa por hacer" : `quedan ${pending} cosas por hacer`}${repsTxt}. No hace falta hacerlo todo hoy: lo que hagas, suma.`;
    $("lede").textContent = lede;
  }

  function renderRewards() {
    const root = $("rewards"); root.replaceChildren();
    const w = wallet();
    if (!state.rewards.length) root.append(el("div", { class: "empty", style: "padding:8px" }, el("span", { text: "Agregá premios que de verdad tengas ganas de darte. Los canjeás con los puntos de tus tareas." })));
    state.rewards.slice().sort((a, b) => a.cost - b.cost).forEach(r => {
      const can = w >= r.cost;
      const info = el("div", {}, el("div", { class: "rt", text: r.text }),
        el("div", { class: "rc num", text: can ? `${r.cost} pts · ¡ya podés!` : `${r.cost} pts · te faltan ${r.cost - w}` }),
        el("div", { class: "mini" }, el("i", { style: `width:${Math.min(100, (w / r.cost) * 100)}%` })));
      const actions = el("div", { class: "row", style: "gap:4px;flex-wrap:nowrap" });
      if (pendingRedeem === r.id) {
        actions.append(
          el("button", { class: "btn sun small", type: "button", text: "Sí, canjear", onclick: () => { pendingRedeem = null; redeem(r); } }),
          el("button", { class: "btn small", type: "button", text: "No", onclick: () => { pendingRedeem = null; renderRewards(); } }));
      } else {
        actions.append(el("button", { class: "btn small" + (can ? " sun" : ""), type: "button", disabled: !can, text: "Canjear", onclick: () => { pendingRedeem = r.id; renderRewards(); } }));
        const del = el("button", { class: "icon", type: "button", "aria-label": "Quitar premio", title: "Quitar premio" });
        del.append(svgIcon("trash"));
        del.addEventListener("click", () => { state.rewards = state.rewards.filter(x => x !== r); persist(); render(); });
        actions.append(del);
      }
      root.append(el("div", { class: "reward" }, info, actions));
    });
    const ideas = $("reward-ideas"); ideas.replaceChildren();
    REWARD_IDEAS.filter(([t]) => !state.rewards.some(r => r.text === t)).slice(0, 4).forEach(([t, c]) => {
      ideas.append(el("button", { class: "chip", type: "button", text: `+ ${t} · ${c}`, onclick: () => { state.rewards.push({ id: uid(), text: t, cost: c }); persist(); render(); } }));
    });
  }

  function renderBadges() {
    const root = $("badges"); root.replaceChildren();
    let n = 0;
    BADGES.forEach(b => {
      const got = !!state.badges[b.id]; if (got) n++;
      const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      s.setAttribute("viewBox", "0 0 40 40");
      let petals = "";
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; petals += `<circle cx="${20 + Math.cos(a) * 9}" cy="${20 + Math.sin(a) * 9}" r="7" fill="var(${b.color})"/>`; }
      s.innerHTML = petals + `<circle cx="20" cy="20" r="6.5" fill="var(--marigold)" stroke="var(--surface)" stroke-width="1.5"/>`;
      root.append(el("div", { class: "badge" + (got ? "" : " locked"), title: b.desc }, s, el("b", { text: b.name }), el("span", { text: b.desc })));
    });
    $("badge-count").textContent = `${n} / ${BADGES.length}`;
  }

  function render() {
    renderGarden(); renderGoals(); renderGoalSelects(); renderStats(); renderList(); renderRewards(); renderBadges(); renderData();
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false"));
  }

  /* ================= editar tarea ================= */
  function openEditor(t) {
    const o = el("div", { class: "overlay sheet-wrap", onclick: (e) => { if (e.target === o) close(); } });
    const close = () => { o.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    let size = t.size;
    const txt = el("textarea", { id: "ed-text", rows: "2", maxlength: "200", "aria-label": "Tarea" }); txt.value = t.text;
    const cat = el("select", { id: "ed-cat", "aria-label": "Categoría" });
    for (const [k, c] of Object.entries(CATS)) cat.append(el("option", { value: k, text: c.label }));
    cat.value = t.cat;
    const seg = el("div", { class: "seg", role: "group", "aria-label": "Tamaño" });
    for (const [k, v] of Object.entries(SIZES)) {
      const b = el("button", { type: "button", "aria-pressed": k === size ? "true" : "false", text: v.label });
      b.addEventListener("click", () => { size = k; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); });
      seg.append(b);
    }
    const due = el("input", { type: "date", id: "ed-due", "aria-label": "Fecha límite" }); due.value = t.due || "";
    const quick = (label, days) => el("button", { class: "chip", type: "button", text: label, onclick: () => {
      if (days === null) { due.value = ""; return; }
      const d = keyToDate(dayKey()); d.setDate(d.getDate() + days); due.value = dateToKey(d);
    } });
    const today = el("input", { type: "checkbox", id: "ed-today" }); today.checked = !!t.today;
    const goalSel = el("select", { id: "ed-goal", "aria-label": "Meta" });
    goalSel.append(el("option", { value: "", text: "Sin meta" }));
    sortedGoals().forEach(g => goalSel.append(el("option", { value: g.id, text: `${goalLabel(g).emoji} ${goalLabel(g).title}` })));
    goalSel.value = t.goal && goalById(t.goal) ? t.goal : "";
    const rep = el("select", { id: "ed-repeat", "aria-label": "Repetir" });
    [["", "Una vez"], ["daily", "Cada día"], ["every2", "Cada 2 días"], ["weekly", "Cada semana"]].forEach(([v, l]) => rep.append(el("option", { value: v, text: l })));
    rep.value = t.repeat || "";
    const dueRow = el("div", { class: "field" }, el("span", { class: "flabel", text: "¿Para cuándo?" }),
      el("div", { class: "row" }, due, quick("Hoy", 0), quick("Mañana", 1), quick("En 1 semana", 7), quick("Sin fecha", null)));
    const bell = el("input", { type: "time", id: "ed-notify", "aria-label": "Hora del aviso" }); bell.value = t.notifyAt || "";
    const bellRow = el("div", { class: "field" }, el("span", { class: "flabel", text: "🔔 Avisarme a las" }),
      el("div", { class: "row" }, bell, el("button", { class: "chip", type: "button", text: "Sin aviso", onclick: () => { bell.value = ""; } })),
      el("p", { class: "data-note", text: "Te llega a esa hora si todavía no la marcaste (con el recordatorio activado)." }));
    const syncRep = () => { dueRow.hidden = !!rep.value; bellRow.hidden = !rep.value; };
    rep.addEventListener("change", syncRep);
    const save = () => {
      const text = txt.value.trim();
      if (!text) { txt.focus(); return; }
      // Si corregiste categoría o tamaño, la app lo aprende para la próxima.
      const change = {};
      if (cat.value !== t.cat) change.cat = cat.value;
      if (size !== t.size) change.size = size;
      let taughtMsg = "";
      if (change.cat || change.size) {
        const r = JC.learnFrom(state.learned, text, change);
        state.learned = r.learned;
        if (change.cat && r.words.length) taughtMsg = ` La próxima vez, «${r.words.slice(0, 3).join(", ")}» va a ${CATS[change.cat].label}.`;
      }
      t.text = text.slice(0, 200); t.cat = cat.value; t.size = size; t.editedAt = Date.now();
      if (!t.done) {
        t.today = today.checked;
        t.goal = rep.value ? "" : goalSel.value;
        if (rep.value !== t.repeat) { t.repeat = rep.value; t.nextDue = 0; }
        t.notifyAt = t.repeat ? bell.value : "";
        t.due = t.repeat ? "" : due.value;
      }
      persist(); render(); close();
      toast("Tarea actualizada." + taughtMsg, "");
    };
    const delBtn = el("button", { class: "btn small danger", type: "button", text: "Borrar tarea", onclick: () => { close(); remove(t); } });
    const card = el("form", { class: "card sheet", role: "dialog", "aria-modal": "true", "aria-label": "Editar tarea", onsubmit: (e) => { e.preventDefault(); save(); } },
      el("div", { class: "sheet-head" }, el("h3", { text: "Editar tarea" }), el("button", { class: "icon", type: "button", "aria-label": "Cerrar", text: "✕", onclick: close })),
      txt,
      el("div", { class: "field" }, el("span", { class: "flabel", text: "Categoría y tamaño" }), el("div", { class: "row" }, cat, seg)),
      t.done ? null : dueRow,
      t.done ? null : el("div", { class: "row" }, el("label", { class: "toggle" }, today, " Para hoy"), rep),
      t.done ? null : bellRow,
      t.done || !state.goals.length ? null : el("div", { class: "field" }, el("span", { class: "flabel", text: "Meta" }), goalSel),
      el("div", { class: "row sheet-actions" }, delBtn, el("button", { class: "btn primary", type: "submit", text: "Guardar" })));
    o.append(card);
    document.body.append(o);
    syncRep();
    txt.focus(); txt.setSelectionRange(txt.value.length, txt.value.length);
  }

  /* ================= feedback ================= */
  function toast(msg, pts, action, extraClass) {
    const t = el("div", { class: "toast" + (extraClass ? " " + extraClass : "") }, el("span", { text: msg }));
    const right = el("div", { class: "row", style: "flex-wrap:nowrap" });
    if (pts) right.append(el("span", { class: "tp num", text: pts }));
    if (action) right.append(el("button", { type: "button", text: action.label, onclick: () => { action.fn(); t.remove(); } }));
    t.append(right);
    const box = $("toasts"); box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), action ? 6000 : 3800);
  }
  function celebrate(title, text) {
    const o = el("div", { class: "overlay", onclick: (e) => { if (e.target === o) o.remove(); } },
      el("div", { class: "card", role: "dialog", "aria-modal": "true" },
        el("div", { class: "eyebrow", text: "¡Felicidades!" }), el("h3", { text: title }), el("p", { text: text }),
        el("button", { class: "btn primary", type: "button", style: "justify-self:center", text: "Seguir", onclick: () => o.remove() })));
    document.body.append(o);
    o.querySelector("button").focus();
  }
  function levelUp(name) {
    celebrate(`Nivel ${name}`, "Tu jardín crece y vos también. Mirá todo lo que ya sacaste de tu cabeza.");
    burst(null, 160); chime(6);
  }

  // petal confetti
  const fx = $("fx"), ctx = fx.getContext("2d");
  let parts = [], raf = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function burst(origin, n) {
    if (reduced) return;
    const dpr = window.devicePixelRatio || 1;
    fx.width = innerWidth * dpr; fx.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let x = innerWidth / 2, y = innerHeight / 3;
    if (origin) { const r = origin.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    const cs = getComputedStyle(document.documentElement);
    const cols = ["--petal-1", "--petal-2", "--petal-3", "--petal-4", "--petal-5", "--leaf"].map(v => cs.getPropertyValue(v).trim());
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (origin ? 6 : 9);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, r: 3 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - .5) * .3, c: pick(cols), life: 70 + Math.random() * 40 });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.vy += .18; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .55, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
    if (!raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // little chime (only after interaction)
  let actx = null;
  function chime(steps) {
    if (!$("sound").checked) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
      for (let i = 0; i < Math.min(steps, notes.length); i++) {
        const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * .08;
        o.type = "sine"; o.frequency.value = notes[i];
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.12, t0 + .01); g.gain.exponentialRampToValueAtTime(.001, t0 + .35);
        o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + .4);
      }
    } catch {}
  }

  /* ================= Claude helpers ================= */
  async function organizeWithClaude(text) {
    const prompt = `Ayudas a una persona agobiada a ordenar sus pendientes. Convierte este volcado de ideas en tareas concretas y accionables, en español rioplatense (vos).
Reglas:
- Una acción por tarea, empieza con un verbo, máximo 70 caracteres.
- No inventes tareas nuevas. Divide una línea solo si contiene claramente varias cosas distintas.
- "cat": una de gatos, casa, viaje, trabajo, creatividad (fotos, videos, arte, escritura no laboral), recados (compras), salud (salud y cuidado personal), personal, otros.
- "size": "s" (menos de 15 min), "m" (15-60 min), "l" (más de 1 hora).
- "today": true solo si suena urgente o tiene fecha muy próxima; como mucho 3 en true.
Responde SOLO con JSON: {"tasks":[{"text":"...","cat":"...","size":"s","today":false}]}

Volcado:
${text}`;
    const res = await sample.json(prompt, { modelTier: "quick" });
    const list = res && Array.isArray(res.tasks) ? res.tasks : [];
    return list.filter(x => x && typeof x.text === "string" && x.text.trim()).slice(0, 60);
  }

  async function splitTask(t, li) {
    if (!sample) return;
    li.classList.add("busy");
    toast("Claude está dividiendo la tarea en pasitos…", "");
    try {
      const res = await sample.json(`Una persona agobiada tiene esta tarea pendiente: "${t.text}" (categoría: ${CATS[t.cat].label}).
Divídela en 3 a 6 pasitos pequeños, concretos y en orden, cada uno de menos de 20 minutos. El primero debe ser muy fácil para arrancar. En español rioplatense (vos), empezando con verbo, máximo 60 caracteres cada uno.
Responde SOLO con JSON: {"steps":["..."]}`, { modelTier: "quick" });
      const steps = (res && Array.isArray(res.steps) ? res.steps : []).filter(s => typeof s === "string" && s.trim()).slice(0, 6);
      if (!steps.length) throw new Error("vacío");
      const idx = state.tasks.indexOf(t);
      const created = steps.map(s => ({ id: uid(), text: s.trim().slice(0, 200), cat: t.cat, size: "s", today: t.today, done: false, doneAt: 0, createdAt: Date.now(), goal: t.goal || "" }));
      state.tasks.splice(idx, 1, ...created);
      forget(t.id);
      unlock("split");
      persist(); render();
      toast(`Dividida en ${created.length} pasitos. Ahora se ve más fácil, ¿no?`, "");
    } catch (e) {
      li.classList.remove("busy");
      toast(e && e.code === "rate_limited" ? "Claude está ocupado. Probá en un rato." : "No se pudo dividir ahora. Intentalo de nuevo más tarde.", "");
    }
  }

  /* ================= events ================= */
  const catSel = $("add-cat");
  for (const [k, c] of Object.entries(CATS)) catSel.append(el("option", { value: k, text: c.label }));
  catSel.value = "personal";
  if (!CATS[catFilter]) catFilter = "";
  if (catFilter) catSel.value = catFilter;

  $("add-size").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-size]"); if (!b) return;
    addSize = b.dataset.size;
    $("add-size").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  });
  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("add-text");
    const p = parseLine(inp.value.trim(), { cat: catSel.value, size: addSize, today: $("add-today").checked, repeat: $("add-repeat").value, due: $("add-due").value, goal: $("add-goal").value });
    const t = addTask(p.text, p.cat, p.size, p.today, p.repeat, p.due, p.goal);
    $("add-due").value = ""; updateAddHint();
    if (!t) return;
    inp.value = "";
    toast(`Anotada en ${CATS[t.cat].label}. Una cosa menos en tu cabeza.`, "");
    if (isToday(t) && tab !== "today") tab = "today";
    if (!isToday(t) && tab === "today" && state.tasks.filter(x => isToday(x) && isPending(x)).length) tab = "all";
    persist(); render();
  });

  function updateAddHint() {
    const bits = [CATS[catSel.value].label, SIZES[addSize].label];
    if ($("add-today").checked) bits.push("para hoy");
    const dg = goalById($("add-goal").value);
    if (dg) bits.push(`${goalLabel(dg).emoji} ${goalLabel(dg).title}`);
    if ($("add-repeat").value) bits.push(REPEATS[$("add-repeat").value]);
    if ($("add-due").value) bits.push("para el " + keyToDate($("add-due").value).toLocaleDateString("es", { day: "numeric", month: "short" }));
    $("add-text").placeholder = `Nueva tarea · ${bits.join(" · ")}`;
  }
  $("add-opts-btn").addEventListener("click", () => {
    const open = $("add-opts").hidden;
    $("add-opts").hidden = !open;
    $("add-opts-btn").setAttribute("aria-expanded", open ? "true" : "false");
  });
  ["add-goal", "dump-goal"].forEach(id => $(id).addEventListener("change", (e) => setDefaultGoal(e.target.value)));
  ["add-cat", "add-today", "add-repeat", "add-due"].forEach(id => $(id).addEventListener("change", updateAddHint));
  $("add-size").addEventListener("click", () => setTimeout(updateAddHint, 0));

  $("pick-btn").addEventListener("click", () => setPicking(!picking));

  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    tab = b.dataset.tab; spotlight = null; render();
  });

  // Etiquetas opcionales en cada línea: #categoria  @rapida|@mediana|@grande  !hoy  !despues  !diaria  !cada2  !semanal
  const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function parseLine(line, defaults) {
    const out = { text: line, cat: catSel.value, size: "m", today: false, repeat: "", goal: defaultGoal(), ...(defaults || {}) };
    const explicit = {};
    out.text = line.replace(/(^|\s)([#@!+])([\p{L}\d/]+)/gu, (m, sp, sign, word) => {
      const w = fold(word);
      if (sign === "+") {
        const g = state.goals.find(g => fold(g.title).split(/\s+/).some(x => x.startsWith(w)) || fold(g.title).replace(/\s+/g, "").startsWith(w));
        if (g) { out.goal = g.id; explicit.goal = true; return ""; }
        return m;
      }
      if (sign === "#") {
        const key = Object.keys(CATS).find(k => k === w || fold(CATS[k].label).split(" ")[0] === w);
        if (key) { out.cat = key; explicit.cat = true; return ""; }
      } else if (sign === "@") {
        const size = { s: "s", rapida: "s", rapidita: "s", m: "m", mediana: "m", l: "l", grande: "l" }[w];
        if (size) { out.size = size; explicit.size = true; return ""; }
      } else {
        if (w === "hoy") { out.today = true; explicit.today = true; return ""; }
        if (w === "despues" || w === "luego" || w === "masadelante" || w === "sinmeta") { out.goal = ""; explicit.goal = true; return ""; }
        if (w === "diaria" || w === "diario") { out.repeat = "daily"; return ""; }
        if (w === "semanal") { out.repeat = "weekly"; return ""; }
        if (w === "cada2" || w === "cada2dias") { out.repeat = "every2"; return ""; }
        if (w === "manana") { const d = keyToDate(dayKey()); d.setDate(d.getDate() + 1); out.due = dateToKey(d); explicit.due = true; return ""; }
        const dm = w.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (dm) {
          const today = keyToDate(dayKey());
          let d = new Date(today.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
          if (d < today && (today - d) > 60 * 86400000) d.setFullYear(d.getFullYear() + 1);
          out.due = dateToKey(d); explicit.due = true; return "";
        }
      }
      return m;
    }).replace(/\s{2,}/g, " ").trim();
    // Lo que no vino con etiqueta, se interpreta del texto
    if (!out.repeat) out.text = datesFromText(out.text, out, explicit);
    const auto = classify(out.text);
    if (!explicit.cat && !catFilter && auto.cat) { out.cat = auto.cat; out.autoCat = true; }
    if (!explicit.size && auto.size) out.size = auto.size;
    if (!explicit.goal) { const g = goalFromText(out.text); if (g) out.goal = g; }
    out.text = out.text.charAt(0).toUpperCase() + out.text.slice(1);
    return out;
  }

  /* ---------- dictado: vaciar la cabeza hablando ---------- */
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  const MIC_IDLE = "Escuchando… contá todo lo que tenés que hacer, como te salga. Cuando termines, tocá «Terminar».";
  function micUI(on) {
    const b = $("dump-mic");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "■ Terminar" : "🎙️ Dictar";
    b.classList.toggle("rec", on);
    if (on) { $("mic-note").hidden = false; $("mic-note").textContent = MIC_IDLE; }
  }
  // Mientras hablás, solo se muestra lo que va entendiendo. Al terminar, se interpreta todo junto
  // (qué cosas son tareas distintas, sin «tengo que» ni muletillas, sin repetidos) y queda en el cuadro para revisar.
  let heard = [], segment = [], finishing = null;
  const heardText = (interim) => JC.mergeHeard([...heard, ...segment, interim || ""]).join(" ");
  function appendLines(lines) {
    const ta = $("dump-text");
    const cur = ta.value.replace(/\s+$/, "");
    ta.value = (cur ? cur + "\n" : "") + lines.join("\n") + "\n";
    ta.scrollTop = ta.scrollHeight;
  }
  function finishDictation() {
    if (!finishing) return;
    clearTimeout(finishing); finishing = null;
    const lines = JC.speechToTasks(JC.mergeHeard([...heard, ...segment]).join(". "));
    heard = []; segment = [];
    micUI(false);
    if (!lines.length) { $("mic-note").hidden = true; return; }
    appendLines(lines);
    $("mic-note").hidden = false;
    $("mic-note").textContent = `Entendí ${lines.length === 1 ? "1 cosa" : lines.length + " cosas"}. Revisalas en el cuadro, corregí lo que haga falta y tocá «Agregar todo».`;
  }
  function stopDictation() {
    if (!listening) return;
    listening = false;
    finishing = setTimeout(finishDictation, 1500);   // por si el navegador no avisa que terminó
    try { rec && rec.stop(); } catch { finishDictation(); }
  }
  $("dump-mic").addEventListener("click", () => {
    if (listening) { stopDictation(); return; }
    if (finishing) return;
    if (!SpeechRec) {
      toast("Este navegador no tiene dictado propio. Tocá el cuadro y usá el micrófono 🎙️ del teclado del celu.", "");
      $("dump-text").focus(); return;
    }
    heard = []; segment = [];
    rec = new SpeechRec();
    rec.lang = "es-AR"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      // se relee la lista entera en cada evento: así no importa si el navegador repite resultados
      const finals = []; let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(r[0].transcript); else interim += r[0].transcript;
      }
      segment = JC.mergeHeard(finals);
      if (listening) {
        const said = heardText(interim);
        $("mic-note").textContent = said ? "Escuchando: «…" + said.slice(-140) + "»" : MIC_IDLE;
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { listening = false; heard = []; segment = []; micUI(false); $("mic-note").hidden = true; toast("Sin permiso para el micrófono. Activalo en los ajustes del teléfono para esta app.", ""); }
      else if (e.error === "network") { listening = false; heard = []; segment = []; micUI(false); $("mic-note").hidden = true; toast("El dictado necesita internet. Probá de nuevo con conexión.", ""); }
    };
    // el reconocimiento se corta solo tras un silencio largo: si seguimos dictando, guardamos lo dicho y lo reactivamos
    rec.onend = () => {
      if (listening) { heard = JC.mergeHeard([...heard, ...segment]); segment = []; try { rec.start(); } catch { stopDictation(); } }
      else finishDictation();
    };
    try { rec.start(); listening = true; micUI(true); } catch { toast("No se pudo iniciar el dictado.", ""); }
  });

  $("dump-add").addEventListener("click", () => {
    const lines = $("dump-text").value.split(/\n+/).map(s => s.replace(/^[\s\-*•·\d.)]+/, "").trim()).filter(Boolean);
    if (!lines.length) { toast("Escribí al menos una cosa, una por línea.", ""); return; }
    if (listening) stopDictation();
    const base = { goal: $("dump-goal").value };
    const byCat = {}, added = [], typed = $("dump-text").value;
    lines.forEach(l => { const p = parseLine(l, base); const t = addTask(p.text, p.cat, p.size, p.today, p.repeat, p.due, p.goal); if (t) { added.push(t); byCat[t.cat] = (byCat[t.cat] || 0) + 1; } });
    const summary = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${CATS[k].label}`).join(" · ");
    $("dump-text").value = ""; $("mic-note").hidden = true;
    if (lines.length >= 5) unlock("dump");
    tab = "all";
    persist(); render();
    toast(`${lines.length} ${lines.length === 1 ? "cosa fuera" : "cosas fuera"} de tu cabeza: ${summary}. Si alguna quedó mal, tocala y la cambiás.`, "",
      { label: "Deshacer", fn: () => { removeMany(added, false); $("dump-text").value = typed; } });
    chime(2);
  });

  $("dump-ai").addEventListener("click", async () => {
    const text = $("dump-text").value.trim();
    if (!text) { toast("Escribí primero lo que tenés en la cabeza.", ""); return; }
    const panel = $("dump"); panel.classList.add("busy");
    $("dump-ai").textContent = "Ordenando…";
    try {
      const list = await organizeWithClaude(text);
      if (!list.length) throw new Error("vacío");
      list.forEach(x => addTask(x.text, x.cat, x.size, x.today, "", "", $("dump-goal").value));
      $("dump-text").value = "";
      if (list.length >= 5) unlock("dump");
      tab = list.some(x => x.today) ? "today" : "all";
      persist(); render();
      toast(`Ordenado: ${list.length} tareas con categoría y tamaño. Ya está todo afuera.`, "");
      chime(3);
    } catch (e) {
      toast(e && e.code === "rate_limited" ? "Claude está ocupado. Usá «Agregar todo» o probá en un rato." : "No se pudo ordenar ahora. Usá «Agregar todo» y ordenalas a mano.", "");
    } finally {
      panel.classList.remove("busy");
      $("dump-ai").textContent = "Ordenar con Claude";
    }
  });

  $("where-start").addEventListener("click", () => {
    const allPending = state.tasks.filter(isPending);
    const pending = allPending;
    if (!pending.length) { toast(state.tasks.length ? "¡No queda nada! Descansá." : "Primero vaciá tu cabeza: escribí todo en el panel «Vaciar la cabeza».", ""); return; }
    const urgent = pending.filter(t => t.due && dueDiff(t) <= 0);
    const pool = urgent.length ? urgent : pending.filter(isToday);
    const nearest = sortedGoals().find(g => (goalDays(g) ?? 0) >= 0 && pending.some(t => t.goal === g.id));
    const src = pool.length ? pool : (nearest ? pending.filter(t => t.goal === nearest.id) : pending);
    const min = Math.min(...src.map(sizeRank));
    const choice = urgent.length ? [...urgent].sort(prio)[0] : pick(src.filter(t => sizeRank(t) === min));
    spotlight = choice.id;
    if (goalFilter && !(goalFilter === "none" ? !choice.goal : choice.goal === goalFilter)) goalFilter = "";
    tab = isToday(choice) ? "today" : "all";
    render();
    const row = document.querySelector(`.task[data-id="${choice.id}"]`);
    if (row) row.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    toast(`Empezá por esta: «${choice.text}». Solo esta. Lo demás puede esperar.`, "");
  });

  $("reward-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("reward-text").value.trim(); if (!text) return;
    const cost = Math.max(5, Math.round(Number($("reward-cost").value) || 100));
    state.rewards.push({ id: uid(), text: text.slice(0, 80), cost });
    $("reward-text").value = "";
    persist(); render();
  });

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".overlay").forEach(o => o.remove()); });

  /* ================= datos: guardado y copias ================= */
  function renderData() {
    const n = $("backup-note");
    if (!n) return;
    if (state.lastBackup) {
      const days = Math.floor((Date.now() - state.lastBackup) / 86400000);
      n.textContent = days === 0 ? "Última copia: hoy. Todo en orden." : `Última copia: hace ${days} ${days === 1 ? "día" : "días"}.` + (days >= 14 ? " Buen momento para hacer otra." : "");
    }
  }
  async function saveBackup() {
    state.lastBackup = Date.now();
    persist(); renderData();
    const json = JSON.stringify({ app: "jardin-pendientes", version: 1, savedAt: new Date().toISOString(), state }, null, 1);
    const name = `jardin-copia-${dayKey()}.json`;
    const file = new File([json], name, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Copia de Jardín de pendientes" });
        toast("Copia lista. Guardala en Archivos, Drive o mandátela por mail.", "");
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try {
      const url = URL.createObjectURL(file);
      const a = el("a", { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Copia descargada.", "");
    } catch { toast("No se pudo guardar la copia en este dispositivo.", ""); }
  }
  $("backup-save").addEventListener("click", saveBackup);
  $("backup-load").addEventListener("click", () => $("backup-file").click());
  $("backup-file").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = normalize(data && data.state ? data.state : data);
      const n = incoming.tasks.length;
      toast(`La copia tiene ${n} ${n === 1 ? "tarea" : "tareas"} y ${incoming.earned} pts. Va a reemplazar lo que hay ahora.`, "", {
        label: "Restaurar", fn: () => { state = incoming; persist(); render(); toast("Copia restaurada. Tu jardín está de vuelta.", ""); chime(3); },
      });
    } catch { toast("Ese archivo no es una copia del jardín.", ""); }
  });

  async function keepDataSafe() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        const ok = already || await navigator.storage.persist();
        if (ok) $("data-status").textContent = "Todo se guarda solo en este teléfono (protegido)";
      }
    } catch {}
  }
  function registerSW() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    if (window.claude) return; // dentro de Claude no hace falta
    // Cuando llega una versión nueva de la app, recargar una vez para mostrarla sin tener que reabrir.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || window.__reloadedForUpdate) return;
      window.__reloadedForUpdate = true;
      saveLocal();
      location.reload();
    });
    navigator.serviceWorker.register("sw.js").then((reg) => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }

  /* ================= sincronización (Supabase) ================= */
  // Cada cuenta tiene una fila en la tabla "boards" con todo el estado.
  // Cambios sin conexión quedan pendientes y se suben al volver; si otro
  // dispositivo cambió mientras tanto, se combinan en vez de pisarse.
  const CFG = window.JARDIN_CONFIG || {};
  const META_KEY = "jardin-sync-meta";
  let sb = null, user = null, channel = null;
  let meta = (() => { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } })();
  let changeSeq = 0, pushing = false, pushAgain = false, pushTimer = null, pulling = null;
  const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} };

  function cloudChanged() {
    changeSeq++;
    if (!meta.dirty) { meta.dirty = true; saveMeta(); }
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 700);
  }


  async function pull() {
    if (!user) return;
    if (pulling) return pulling;
    pulling = (async () => {
      setSync("syncing");
      const { data, error } = await sb.from("boards").select("state, rev, updated_at").eq("user_id", user.id).maybeSingle();
      if (error) { setSync(navigator.onLine ? "error" : "offline"); return; }
      if (!data) { await push(); return; }
      if (data.rev === meta.lastRev) { if (meta.dirty) await push(); else markSynced(data.updated_at); return; }
      const remote = normalize(data.state);
      if (meta.dirty && hasContent(state)) {
        state = mergeStates(state, remote);
        meta.lastRev = data.rev; saveMeta();
        saveLocal(); render();
        await push();
        if (hasContent(remote)) toast("Juntamos lo que hiciste en tus otros dispositivos.", "");
      } else {
        state = remote;
        meta.lastRev = data.rev; meta.dirty = false; saveMeta();
        saveLocal(); render();
        markSynced(data.updated_at);
      }
    })().finally(() => { pulling = null; });
    return pulling;
  }

  async function push() {
    if (!user) return;
    if (pushing) { pushAgain = true; return; }
    pushing = true; clearTimeout(pushTimer);
    setSync("syncing");
    const seq = changeSeq, rev = uid(), now = new Date().toISOString();
    const row = { user_id: user.id, state: clone(state), rev, updated_at: now };
    let conflict = false, failed = false;
    try {
      if (meta.lastRev) {
        const { data, error } = await sb.from("boards").update(row).eq("user_id", user.id).eq("rev", meta.lastRev).select("rev");
        if (error) failed = true; else if (!data || !data.length) conflict = true;
      } else {
        const { error } = await sb.from("boards").insert(row);
        if (error) { if (error.code === "23505") conflict = true; else failed = true; }
      }
    } catch { failed = true; }
    pushing = false;
    if (failed) { setSync(navigator.onLine ? "error" : "offline"); return; }
    if (conflict) { meta.dirty = true; meta.lastRev = meta.lastRev || null; saveMeta(); await pull(); return; }
    meta.lastRev = rev;
    meta.dirty = changeSeq !== seq;
    saveMeta();
    markSynced(now);
    if (pushAgain || meta.dirty) { pushAgain = false; push(); }
  }

  function markSynced(when) {
    meta.syncedAt = when || new Date().toISOString(); saveMeta();
    setSync(meta.dirty ? "syncing" : "ok");
    renderAccount();
  }

  function subscribe() {
    unsubscribe();
    channel = sb.channel("board-" + user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "boards", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row = payload.new || {};
        if (row.rev && row.rev !== meta.lastRev && !pushing) pull();
      })
      .subscribe();
  }
  function unsubscribe() { if (channel) { sb.removeChannel(channel); channel = null; } }

  function renderAccount() {
    if (!sb) return;
    $("account").hidden = false;
    $("acc-in").hidden = !user;
    $("acc-form").hidden = !!user;
    $("data-status").hidden = !!user;
    renderRemind();
    if (user) {
      $("acc-who").textContent = `Sincronizado como ${user.email}`;
      const t = meta.syncedAt ? new Date(meta.syncedAt) : null;
      $("acc-when").textContent = t ? `Última sincronización: ${t.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
    }
  }

  function initSync() {
    if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase || window.claude) return;
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "jardin-auth" } });
    } catch { sb = null; return; }
    if (meta.lastRev === undefined && hasContent(state)) { meta.dirty = true; saveMeta(); }
    renderAccount();
    sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setTimeout(openNewPassword, 0);
      const u = session ? session.user : null;
      if ((u && u.id) === (user && user.id)) return;
      // Otra cuenta en este dispositivo: empezar a sincronizar desde cero.
      if (u && meta.userId && meta.userId !== u.id) { meta = { dirty: hasContent(state) }; }
      user = u;
      if (user) { meta.userId = user.id; saveMeta(); setTimeout(() => { pull(); subscribe(); }, 0); }
      else { unsubscribe(); setSync("local"); }
      renderAccount();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && user) pull(); });
    window.addEventListener("online", () => { if (user) pull(); });
    window.addEventListener("offline", () => { if (user) setSync("offline"); });
  }

  const accMsg = (t) => { $("acc-msg").textContent = t; };
  function authError(e) {
    const m = (e && e.message || "").toLowerCase();
    if (m.includes("invalid login")) return "Mail o contraseña incorrectos.";
    if (m.includes("not confirmed")) return "Falta confirmar tu mail: abrí el correo que te llegó y tocá el enlace. Después volvé a Entrar.";
    if (m.includes("already registered")) return "Ese mail ya tiene cuenta. Tocá Entrar.";
    if (m.includes("password")) return "La contraseña tiene que tener al menos 6 caracteres.";
    if (m.includes("fetch") || !navigator.onLine) return "Sin conexión. Probá cuando tengas internet.";
    return "No se pudo: " + (e && e.message || "error desconocido");
  }
  $("acc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return;
    const form = $("acc-form"); form.classList.add("busy"); accMsg("Entrando…");
    const { error } = await sb.auth.signInWithPassword({ email: $("acc-email").value.trim(), password: $("acc-pass").value });
    form.classList.remove("busy");
    if (error) accMsg(authError(error)); else { accMsg(""); $("acc-pass").value = ""; toast("¡Listo! Tu jardín ahora se sincroniza.", ""); chime(3); }
  });
  // Recuperar la contraseña: llega un mail; el enlace abre la app y pide la nueva.
  $("acc-forgot").addEventListener("click", async () => {
    if (!sb) return;
    const email = $("acc-email").value.trim();
    if (!email) { accMsg("Escribí tu mail arriba y volvé a tocar «¿Olvidaste tu contraseña?»."); $("acc-email").focus(); return; }
    accMsg("Enviando…");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    accMsg(error ? authError(error) : "Te mandamos un mail. Tocá el enlace y vas a poder elegir una contraseña nueva.");
  });
  function openNewPassword() {
    const o = el("div", { class: "overlay sheet-wrap" });
    const pass = el("input", { type: "password", id: "new-pass", minlength: "6", autocomplete: "new-password", placeholder: "Contraseña nueva (mín. 6)", "aria-label": "Contraseña nueva" });
    const msg = el("p", { class: "data-note", role: "status" });
    const card = el("form", { class: "card sheet", role: "dialog", "aria-modal": "true", "aria-label": "Contraseña nueva", onsubmit: async (e) => {
      e.preventDefault();
      if (pass.value.length < 6) { msg.textContent = "Tiene que tener al menos 6 caracteres."; return; }
      msg.textContent = "Guardando…";
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) { msg.textContent = authError(error); return; }
      o.remove();
      history.replaceState(null, "", location.pathname);
      toast("Listo, contraseña cambiada. Ya estás adentro.", "");
    } },
      el("div", { class: "sheet-head" }, el("h3", { text: "Elegí una contraseña nueva" })),
      el("div", { class: "field" }, pass), msg,
      el("div", { class: "row sheet-actions" }, el("span"), el("button", { class: "btn primary", type: "submit", text: "Guardar" })));
    o.append(card);
    document.body.append(o);
    pass.focus();
  }

  $("acc-signup").addEventListener("click", async () => {
    if (!sb) return;
    const email = $("acc-email").value.trim(), password = $("acc-pass").value;
    if (!email || password.length < 6) { accMsg("Escribí tu mail y una contraseña de al menos 6 caracteres."); return; }
    const form = $("acc-form"); form.classList.add("busy"); accMsg("Creando cuenta…");
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    form.classList.remove("busy");
    if (error) { accMsg(authError(error)); return; }
    if (data && data.session) { accMsg(""); toast("Cuenta creada. Tu jardín ya se sincroniza.", ""); chime(3); }
    else accMsg("Te mandamos un mail para confirmar la cuenta. Tocá el enlace, después volvé acá y tocá Entrar.");
  });
  $("acc-out").addEventListener("click", async () => {
    if (!sb) return;
    await sb.auth.signOut();
    toast("Sesión cerrada. Tus datos siguen guardados en este teléfono.", "");
  });
  $("acc-sync").addEventListener("click", () => { if (user) pull(); });

  /* ---------- recordatorio diario (Web Push vía Supabase) ---------- */
  const REMIND_KEY = "jardin-remind";
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!CFG.vapidPublicKey;
  const remindMsg = (t) => { $("remind-msg").textContent = t; };
  const remindSaved = () => { try { return JSON.parse(localStorage.getItem(REMIND_KEY)) || null; } catch { return null; } };
  const keyBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  for (let h = 6; h <= 23; h++) $("remind-hour").append(el("option", { value: String(h), text: `${h}:00` }));
  $("remind-hour").value = String((remindSaved() || {}).hour || 9);
  $("remind-evening").append(el("option", { value: "", text: "Apagado" }));
  for (let h = 18; h <= 23; h++) $("remind-evening").append(el("option", { value: String(h), text: `${h}:00` }));
  $("remind-evening").value = (remindSaved() || {}).evening != null ? String(remindSaved().evening) : "";
  $("remind-weekly").checked = (remindSaved() || {}).weekly !== false;

  async function renderRemind() {
    const box = $("remind");
    if (!sb || !user) { box.hidden = true; return; }
    box.hidden = false;
    if (!pushSupported()) {
      ["remind-on", "remind-test", "remind-off"].forEach(id => $(id).hidden = true);
      $("remind-hour").disabled = true;
      remindMsg(/iphone|ipad/i.test(navigator.userAgent) ? "En iPhone primero instalá la app en la pantalla de inicio y abrila desde el ícono." : "Este navegador no permite notificaciones.");
      return;
    }
    let sub = null;
    try { const reg = await navigator.serviceWorker.getRegistration(); sub = reg ? await reg.pushManager.getSubscription() : null; } catch {}
    const on = !!sub && !!remindSaved() && Notification.permission === "granted";
    $("remind-on").hidden = on; $("remind-test").hidden = !on; $("remind-off").hidden = !on; $("remind-extra").hidden = !on;
    if (on && !$("remind-msg").textContent) remindMsg(`Activado en este dispositivo: mañana a las ${remindSaved().hour}:00.`);
  }

  async function saveSub(sub) {
    const j = sub.toJSON();
    const hour = Number($("remind-hour").value);
    const evening = $("remind-evening").value === "" ? null : Number($("remind-evening").value);
    const weekly = $("remind-weekly").checked;
    const row = { endpoint: j.endpoint, user_id: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth,
      hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires", enabled: true, evening_hour: evening, weekly };
    let { error } = await sb.from("push_subs").upsert(row, { onConflict: "endpoint" });
    if (error && /evening_hour|weekly|column/i.test(error.message || "")) {
      // la base todavía no tiene las columnas nuevas: guardar lo básico y avisar
      delete row.evening_hour; delete row.weekly;
      ({ error } = await sb.from("push_subs").upsert(row, { onConflict: "endpoint" }));
      if (!error) remindMsg("Guardado lo básico. Para la noche y el repaso semanal falta actualizar la tabla en Supabase.");
    }
    if (error) throw error;
    try { localStorage.setItem(REMIND_KEY, JSON.stringify({ hour, evening, weekly })); } catch {}
    return hour;
  }

  $("remind-on").addEventListener("click", async () => {
    if (!pushSupported() || !user) return;
    remindMsg("Activando…");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { remindMsg("Sin permiso para notificaciones. Activalo en los ajustes del teléfono para esta app y volvé a intentar."); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CFG.vapidPublicKey) });
      const hour = await saveSub(sub);
      remindMsg(`¡Listo! Todos los días a las ${hour}:00 te llega lo de hoy. Tocá «Probar ahora» para ver cómo se ve.`);
      chime(3);
    } catch (e) {
      remindMsg("No se pudo activar: " + ((e && e.message) || "error") + ". ¿Ya creaste la tabla de recordatorios en Supabase?");
    }
    renderRemind();
  });
  ["remind-evening", "remind-weekly"].forEach(id => $(id).addEventListener("change", async () => {
    if (!remindSaved() || !user) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await saveSub(sub); if (!/falta actualizar/.test($("remind-msg").textContent)) remindMsg("Avisos actualizados."); }
    } catch (e) { remindMsg("No se pudo guardar: " + ((e && e.message) || "error")); }
  }));
  $("remind-hour").addEventListener("change", async () => {
    if (!remindSaved() || !user) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { const h = await saveSub(sub); remindMsg(`Cambiado: ahora a las ${h}:00.`); }
    } catch (e) { remindMsg("No se pudo cambiar la hora: " + ((e && e.message) || "error")); }
  });
  $("remind-off").addEventListener("click", async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await sb.from("push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    } catch {}
    try { localStorage.removeItem(REMIND_KEY); } catch {}
    remindMsg("Recordatorio desactivado en este dispositivo.");
    renderRemind();
  });
  $("remind-test").addEventListener("click", async () => {
    remindMsg("Enviando…");
    try {
      if (meta.dirty) await push(); // que la nube tenga lo último antes de armar el mensaje
      const { data } = await sb.auth.getSession();
      const res = await fetch(`${CFG.supabaseUrl}/functions/v1/daily-reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.supabaseKey, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ test: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) remindMsg(`No se pudo enviar (${res.status}). ${out.error || "¿Ya está creada la función daily-reminder?"}`);
      else remindMsg(out.sent ? "Enviada. Debería llegarte en unos segundos." : "La función respondió, pero no encontró este dispositivo. Desactivá y volvé a activar.");
    } catch (e) { remindMsg("No se pudo contactar a Supabase: " + ((e && e.message) || "error")); }
  });
  $("sync").addEventListener("click", () => $("data-panel").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));

  /* ================= boot ================= */
  $("today-label").textContent = logicalDate().toLocaleDateString("es", window.innerWidth < 600 ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "long", day: "numeric", month: "long" });
  state = loadLocal() || blank();
  render();
  connectDb();
  keepDataSafe();
  initSync();
  registerSW();
  updateAddHint();
  window.addEventListener("pagehide", saveLocal);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveLocal(); else render(); });
  connectSample().then(s => {
    sample = s;
    if (sample) { $("dump-ai").hidden = false; $("dump-note").hidden = false; render(); }
  });
})();
