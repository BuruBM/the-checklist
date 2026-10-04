// Jardín de pendientes · interpretar lo escrito o dictado (sin DOM).
// Reglas de palabras clave revisadas con la usuaria + lo que aprende de sus correcciones.
(function (root) {
  "use strict";
  const dateToKey = (d) => d.toLocaleDateString("sv-SE");

  /* ---------- interpretar lo escrito o dictado: categoría, tamaño, fecha y meta ---------- */
  // Las claves se comparan sin mayúsculas ni tildes (la ñ se respeta) y por comienzo de palabra;
  // con "=" delante, la palabra tiene que ser exacta.
  const foldN = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-̂̄-ͯ]/g, "").normalize("NFC");
  const CAT_RULES = {
    // 1) Gatos gana siempre
    gatos: ["gato", "michi", "milo", "zoe", "veterin", "=vete", "arena", "piedra", "pipeta", "antipulga", "desparasit", "sieger", "felifat", "proteliv",
      "alimento", "fuente", "rascador", "hipoalergen", "royal", "canin", "suplemento", "seniorline", "tachito"],
    // 2) Cosas específicas (si hay varias, gana la que aparece primero en la frase)
    viaje: ["viaj", "valija", "equipaje", "pasaporte", "vuelo", "pasaje", "despegar", "hotel", "aeropuerto", "=check", "checkin", "playa", "bikini", "pareo", "protector"],
    salud: ["turno", "medic", "doctor", "dentista", "odontolog", "dermatolog", "ginecolog", "analisis", "estudio", "receta", "remedio", "vacuna", "depil", "=dep",
      "uñas", "pelo", "peluquer", "kinesi", "psicolog", "terapia", "gimnasio", "=gym", "yoga", "estir", "osteo", "=eco", "ecograf", "=pap", "gillette",
      "maggie", "sara", "tintur", "teñ"],
    trabajo: ["trabajo", "cliente", "presupuesto", "factur", "informe", "presentacion", "propuesta", "reunion", "entrega", "escuela", "colegio", "taller", "flex"],
    casa: ["heladera", "baño", "cocina", "sabana", "toalla", "ropa", "placard", "armario", "cajon", "planta", "basura", "gasista", "electricista", "plomer",
      "termica", "estufa", "pared", "llave", "expensa", "alquiler", "=luz", "=gas", "anafe", "mudanza", "celeste", "=regar"],
    personal: ["cumple", "amig", "=mama", "=papa", "abuel", "curso", "ingles", "=leer", "=dni", "licencia", "banco", "tramite", "tarjeta", "seguro"],
  };
  // 3) Débiles: solo si no hubo nada de lo anterior (en este orden)
  const WEAK_RULES = [
    ["creatividad", ["foto", "video", "edit", "edicion", "=reel", "dibuj", "ilustr", "pint", "acuarela", "collage", "music", "cancion", "guion", "escrib", "cuento",
      "poema", "portfolio", "diseñ", "camara", "filma", "graba"]],
    ["casa", ["limpi", "lava", "orden", "barr", "aspir", "planch", "arregl"]],
    ["recados", ["compr", "super", "mercado", "farmacia", "retir", "devolv", "regalo"]],
  ];
  const SIZE_RULES = {
    s: ["llam", "mand", "envi", "avis", "pag", "transfer", "confirm", "reserv", "ped", "revis", "cheque", "averigu", "consult", "medic", "=regar", "cambi", "cort", "=poner", "ponerle", "tir"],
    m: ["compr", "busc", "limpi", "lav", "orden", "coordin", "prepar", "arm", "hac", "=ir", "retir", "devolv", "tap", "arregl", "cocin"],
    l: ["termin", "pint", "renov", "mud", "escrib", "diseñ", "edit", "organiz"],
  };
  const wordHit = (words, key) => key.startsWith("=") ? words.indexOf(key.slice(1)) : words.findIndex(w => w.startsWith(key));
  const wordsOf = (text) => foldN(text).split(/[^a-z0-9ñ]+/).filter(Boolean);
  // learned = { cat: { palabra: categoría }, size: { verbo: tamaño } }: lo que la persona corrigió a mano gana sobre las reglas.
  function classify(text, learned) {
    const words = wordsOf(text);
    const has = (keys) => { let best = -1; for (const k of keys) { const i = wordHit(words, k); if (i >= 0 && (best < 0 || i < best)) best = i; } return best; };
    let cat = null;
    const lc = (learned && learned.cat) || {}, ls = (learned && learned.size) || {};
    for (const w of words) if (lc[w]) { cat = lc[w]; break; }
    const billy = has(["pag", "factur", "boleta", "servicio"]) >= 0;
    if (!cat && (has(CAT_RULES.gatos) >= 0 || (!billy && has(["agua"]) >= 0))) cat = "gatos";
    if (!cat) {
      let best = Infinity;
      for (const k of ["viaje", "salud", "trabajo", "casa", "personal"]) { const i = has(CAT_RULES[k]); if (i >= 0 && i < best) { best = i; cat = k; } }
      if (!cat && billy && has(["agua"]) >= 0) cat = "casa";
    }
    if (!cat) for (const [k, keys] of WEAK_RULES) if (has(keys) >= 0) { cat = k; break; }
    // tamaño: el primer verbo de la frase; «todo / a fondo / completo» lo agranda, «rápido / un mensaje» lo achica
    let size = null, first = Infinity;
    if (words.length && ls[words[0]]) size = ls[words[0]];
    else for (const [k, keys] of Object.entries(SIZE_RULES)) { const i = has(keys); if (i >= 0 && i < first) { first = i; size = k; } }
    if (size) {
      const order = ["s", "m", "l"]; let i = order.indexOf(size);
      const f = " " + words.join(" ") + " ";
      if (/ (todo|toda|todos|todas|completo|completa|general) | a fondo /.test(f)) i = Math.min(2, i + 1);
      if (/ (rapido|rapidito|whatsapp) | un mensaje /.test(f)) i = Math.max(0, i - 1);
      size = order[i];
    }
    return { cat, size };
  }
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  // Fechas dichas con palabras: «hoy», «mañana», «el viernes», «el 15 de octubre», «15/10». Devuelve el texto sin esas palabras.
  // today: la fecha del día (lógico) actual, a las 00:00.
  function datesFromText(text, out, explicit, today) {
    const setDue = (d) => { if (!explicit.due) out.due = dateToKey(d); };
    let t = text;
    t = t.replace(/(^|\s)(?:para\s+)?hoy(?=$|[\s,.;!?])/i, (m, sp) => { if (!explicit.today) out.today = true; return sp; });
    t = t.replace(/(^|\s)(?:para\s+)?pasado\s+mañana(?=$|[\s,.;!?])/i, (m, sp) => { const d = new Date(today); d.setDate(d.getDate() + 2); setDue(d); return sp; });
    t = t.replace(/(^|\s)(?:para\s+)?mañana(?=$|[\s,.;!?])/i, (m, sp, off, all) => {
      if (/\b(la|esta|cada)\s*$/i.test(all.slice(0, off + sp.length))) return m;     // «a la mañana», «esta mañana»
      const d = new Date(today); d.setDate(d.getDate() + 1); setDue(d); return sp;
    });
    t = t.replace(/(^|\s)(?:para\s+)?(?:el|este)?\s*(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?=$|[\s,.;!?])/i, (m, sp, day) => {
      const target = WEEKDAYS.indexOf(foldN(day));
      const d = new Date(today); let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
      d.setDate(d.getDate() + add); setDue(d); return sp;
    });
    t = t.replace(/(^|\s)(?:para\s+)?(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?=$|[\s,.;!?])/i, (m, sp, dd, mon) => {
      const mi = MONTHS.indexOf(foldN(mon) === "setiembre" ? "septiembre" : foldN(mon));
      let d = new Date(today.getFullYear(), mi, Number(dd)); if (d < today && (today - d) > 60 * 86400000) d.setFullYear(d.getFullYear() + 1);
      setDue(d); return sp;
    });
    t = t.replace(/(^|\s)(?:para\s+)?(?:el\s+)?(\d{1,2})\/(\d{1,2})(?=$|[\s,.;!?])/, (m, sp, dd, mm) => {
      let d = new Date(today.getFullYear(), Number(mm) - 1, Number(dd)); if (d < today && (today - d) > 60 * 86400000) d.setFullYear(d.getFullYear() + 1);
      setDue(d); return sp;
    });
    return t.replace(/\s{2,}/g, " ").replace(/\s+([,.;!?])/g, "$1").trim();
  }
  // Meta nombrada en la frase («para la playa» → 🏖️ La Playa)
  // goals: las metas vigentes, de la más próxima a la más lejana.
  function goalFromText(text, goals) {
    const words = wordsOf(text);
    const stop = new Set(["para", "con", "del", "las", "los", "una", "unos", "unas"]);
    for (const g of goals) {
      const keys = foldN(g.title).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 4 && !stop.has(w));
      if (keys.some(k => words.includes(k))) return g.id;
    }
    return null;
  }
  // Aprender de una corrección hecha a mano en la ficha de una tarea.
  // Categoría: se asocia a las palabras propias de la frase (no a verbos ni palabras comunes).
  // Tamaño: se asocia al primer verbo.
  const COMMON = new Set(["para", "con", "del", "las", "los", "una", "unos", "unas", "que", "por", "sobre", "como", "este", "esta", "todo", "toda", "algo", "cosas", "hacer"]);
  const isVerbish = (w) => Object.values(SIZE_RULES).some(keys => keys.some(k => k.startsWith("=") ? w === k.slice(1) : w.startsWith(k)));
  function learnFrom(learned, text, change) {
    const out = { cat: { ...((learned && learned.cat) || {}) }, size: { ...((learned && learned.size) || {}) } };
    const words = wordsOf(text);
    const taught = [];
    if (change.cat) {
      for (const w of words) if (w.length >= 4 && !COMMON.has(w) && !isVerbish(w) && !/^\d+$/.test(w)) { out.cat[w] = change.cat; taught.push(w); }
    }
    if (change.size && words.length) { out.size[words[0]] = change.size; }
    const cap = (o) => Object.fromEntries(Object.entries(o).slice(-300));
    return { learned: { cat: cap(out.cat), size: cap(out.size) }, words: taught };
  }

  /* ---------- dictado: de lo hablado a una lista de tareas ---------- */
  const keyOf = (s) => foldN(s).replace(/[^a-z0-9ñ]+/g, " ").trim();
  const LITTLE = new Set(["a", "al", "la", "el", "los", "las", "lo", "de", "del", "en", "con", "y", "e", "un", "una", "unos", "unas", "para", "por", "que", "mi", "mis", "su", "sus", "le", "les", "me", "se"]);
  const sigWords = (s) => new Set(keyOf(s).split(" ").filter(w => w && !LITTLE.has(w)));
  // ¿Dicen lo mismo? (una contiene a la otra, o comparten casi todas las palabras: «lavar ropa en tre casa» ≈ «lavar ropa entre casa»)
  function sameThing(a, b) {
    const A = sigWords(a), B = sigWords(b);
    const small = Math.min(A.size, B.size);
    if (!small) return keyOf(a) === keyOf(b);
    let common = 0; for (const w of A) if (B.has(w)) common++;
    return common / small >= 0.75;
  }
  // Algunos celulares (Chrome en Android) repiten lo ya reconocido: cada resultado trae el anterior
  // completo, vuelve a mandar una frase o la manda corregida. Queda una sola versión de cada frase, la más completa.
  function mergeHeard(parts) {
    const out = [];
    for (const raw of parts) {
      const t = (raw || "").trim();
      if (!keyOf(t)) continue;
      const i = out.findIndex(o => sameThing(o, t) || keyOf(t).startsWith(keyOf(o)));
      if (i < 0) { out.push(t); continue; }
      if (sigWords(t).size >= sigWords(out[i]).size) out[i] = t;
    }
    return out;
  }
  // Sustantivos comunes que terminan como un infinitivo
  const NOT_VERBS = new Set(["lugar", "hogar", "collar", "taller", "mujer", "placer", "azucar", "dolar", "militar", "familiar", "celular", "particular",
    "regular", "alquiler", "ayer", "super", "cualquier", "primer", "tercer", "alfiler", "bar", "mar", "par", "altar", "polar", "solar", "titular", "estar",
    "oscar", "javier", "omar", "edgar", "walter", "peter", "ester", "esther", "cesar", "baltasar", "gaspar", "aguilar", "escobar", "dormitorio"]);
  const isInfinitive = (w) => {
    const f = foldN(w).replace(/[^a-zñ]/g, "");
    if (f === "ir" || f === "irme" || f === "irse") return true;
    if (f.length < 3 || NOT_VERBS.has(f)) return false;
    return /(ar|er|ir)$/.test(f) || /^.{2,}(ar|er|ir)(lo|la|los|las|le|les|me|te|se|nos|selo|sela|melo|mela)$/.test(f);
  };
  // Frases que anuncian una tarea nueva: después de un «y», cortan
  const STARTERS = new Set(["tengo", "tendria", "hay", "necesito", "debo", "deberia", "quiero", "acordarme", "falta", "me", "no"]);
  const INTENT = /^(?:(?:y|e|que|entonces|tambien|despues|ademas|bueno|ah)\s+)*(?:yo\s+)?(?:no\s+me\s+(?:tengo|puedo)\s+que?\s*olvidar\s+de|no\s+olvidarme\s+de|me\s+tengo\s+que\s+acordar\s+de|acordarme\s+de|tengo\s+que|tendria\s+que|hay\s+que|necesito|deberia|debo|quiero|me\s+falta|me\s+gustaria|tengo\s+pendiente)\s+/;
  const FILLERS = /(^|[\s,])(?:eh+m*|em+|mm+|bueno|o sea|digamos|viste)(?=$|[\s,.])/gi;
  const CONNECTORS = /\s*(?:[,;.!?:]+|\b(?:y\s+)?(?:despu[eé]s|luego|tambi[eé]n|adem[aá]s|aparte|otra cosa|por otro lado|por [uú]ltimo)(?![\p{L}]))\s*/iu;

  // Palabras después de las cuales un verbo sigue siendo parte de la misma tarea («ir a comprar», «para cocinar», «tengo que llamar»)
  const GLUE = new Set(["a", "al", "de", "del", "para", "por", "que", "sin", "en", "con", "el", "la", "lo", "le", "me", "te", "se", "y", "e", "o", "ni", "como",
    "voy", "vamos", "puedo", "quiero", "necesito", "debo", "tengo", "hay", "sabe", "hacer", "dejar", "volver", "empezar", "terminar", "ir", "antes", "despues", "hasta", "mientras"]);

  // «tengo que revisar el checklist y agregar un par de cosas, después ordenar la casa»
  //   → ["Revisar el checklist", "Agregar un par de cosas", "Ordenar la casa"]
  function speechToTasks(text) {
    const pieces = [];
    const clean = (text || "").replace(FILLERS, "$1").replace(/\s{2,}/g, " ");
    for (const chunk of clean.split(CONNECTORS)) {
      if (!chunk || !chunk.trim()) continue;
      // un «y» seguido de otro verbo (o de «tengo que», «hay que»…) separa dos tareas
      const words = chunk.trim().split(/\s+/);
      let cur = [];
      words.forEach((w, i) => {
        const f = foldN(w);
        const next = words[i + 1];
        if ((f === "y" || f === "e") && cur.length && next && (isInfinitive(next) || STARTERS.has(foldN(next)))) { pieces.push(cur.join(" ")); cur = []; return; }
        // sin coma ni «y»: un verbo nuevo después de un sustantivo empieza otra tarea («lavar ropa ordenar casa»)
        const prev = cur.length ? foldN(cur[cur.length - 1]).replace(/[^a-zñ]/g, "") : "";
        if (cur.length >= 2 && isInfinitive(w) && !GLUE.has(prev) && !isInfinitive(prev) && cur.some(x => isInfinitive(x))) { pieces.push(cur.join(" ")); cur = []; }
        cur.push(w);
      });
      if (cur.length) pieces.push(cur.join(" "));
    }
    const out = [];
    for (let p of pieces) {
      // sacar «tengo que», «hay que», «necesito»… del principio (comparando sin tildes)
      for (let guard = 0; guard < 4; guard++) {
        const m = foldN(p).match(INTENT);
        if (!m) break;
        p = p.slice(m[0].length);
      }
      p = p.replace(/^(?:y|e)\s+/i, "").replace(/\s+(?:y|e)$/i, "").replace(/[\s,.;:!?¿¡-]+$/, "").replace(/^[\s,.;:!?¿¡-]+/, "").trim();
      if (p.length < 3 || !/\p{L}/u.test(p)) continue;
      p = p.charAt(0).toUpperCase() + p.slice(1);
      // la misma tarea dicha dos veces (o casi igual) queda una sola vez, en su versión más completa
      const i = out.findIndex(o => sameThing(o, p));
      if (i < 0) out.push(p);
      else if (sigWords(p).size > sigWords(out[i]).size) out[i] = p;
    }
    return out;
  }

  const api = { foldN, wordsOf, CAT_RULES, WEAK_RULES, SIZE_RULES, classify, datesFromText, goalFromText, learnFrom, mergeHeard, speechToTasks, isInfinitive };
  root.JardinClassify = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
