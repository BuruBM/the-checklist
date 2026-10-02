// Clasificador: las reglas acordadas, probadas con frases reales de la lista.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classify, datesFromText, goalFromText, learnFrom } = require("../../js/classify.js");

const CASES = [
  ["comprar alimento seco gatos", "gatos", "m"], ["comprar sieger", "gatos", "m"], ["revisar felifat y proteliv", "gatos", "s"],
  ["cambiar agua cuarto", "gatos", "s"], ["lavar fuente agua", "gatos", "m"], ["medicar Milo", "gatos", "s"], ["limpiar piedras", "gatos", "m"],
  ["comprar Royal Canin hipoalergénico", "gatos", "m"], ["cambiar sábanas", "casa", "s"], ["coordinar con gasista para sacar estufa", "casa", "m"],
  ["pintar pared estufa", "casa", "l"], ["coordinar Celeste", "casa", "m"], ["buscar anafe eléctrico", "casa", "m"], ["pagar el agua", "casa", "s"],
  ["ordenar todo el placard", "casa", "l"], ["revisar despegar", "viaje", "s"], ["pedir asistencia al viajero Visa", "viaje", "s"],
  ["comprarme bikini", "viaje", "m"], ["comprar protector para la playa", "viaje", "m"], ["mandar presupuesto Flex", "trabajo", "s"],
  ["editar video del taller", "trabajo", "l"], ["editar video de las vacaciones", "creatividad", "l"], ["pintar una acuarela", "creatividad", "l"],
  ["cortarme uñas", "salud", "s"], ["chequear turno Sara", "salud", "s"], ["gillette", "salud", null], ["pedir turno ecografía", "salud", "s"],
  ["ir al osteópata", "salud", "m"], ["comprar pilas", "recados", "m"], ["terminar form gates", null, "l"],
];
for (const [text, cat, size] of CASES) {
  test(`«${text}» → ${cat || "(sin categoría)"} · ${size || "(sin tamaño)"}`, () => {
    assert.deepEqual(classify(text), { cat, size });
  });
}

test("lo que corregiste a mano gana sobre las reglas", () => {
  const { learned, words } = learnFrom(null, "Llamar a Celina", { cat: "trabajo" });
  assert.deepEqual(words, ["celina"]);
  assert.equal(classify("mandarle el informe a Celina", learned).cat, "trabajo");
  assert.equal(classify("llamar a mamá", learned).cat, "personal"); // «llamar» no se aprende como categoría
  const s = learnFrom(learned, "Averiguar precio de pasajes", { size: "m" }).learned;
  assert.equal(classify("averiguar horario del vete", s).size, "m");
});

const today = new Date(2026, 9, 2); // viernes 2/10/2026
const dated = (text) => { const out = {}; const rest = datesFromText(text, out, {}, today); return { rest, ...out }; };
test("fechas dichas con palabras", () => {
  assert.deepEqual(dated("llamar al vete mañana"), { rest: "llamar al vete", due: "2026-10-03" });
  assert.deepEqual(dated("pintar una acuarela hoy"), { rest: "pintar una acuarela", today: true });
  assert.deepEqual(dated("comprar Royal Canin el viernes"), { rest: "comprar Royal Canin", due: "2026-10-09" });
  assert.deepEqual(dated("pedir turno el 15 de octubre"), { rest: "pedir turno", due: "2026-10-15" });
  assert.deepEqual(dated("mandar papeles 20/10"), { rest: "mandar papeles", due: "2026-10-20" });
  assert.deepEqual(dated("ir al osteópata a la mañana"), { rest: "ir al osteópata a la mañana" });
});

test("la meta se reconoce si se la nombra", () => {
  const goals = [{ id: "gp", title: "La Playa" }, { id: "ge", title: "Estudio médico" }];
  assert.equal(goalFromText("comprar protector para la playa", goals), "gp");
  assert.equal(goalFromText("ayuno para el estudio", goals), "ge");
  assert.equal(goalFromText("pagar expensas", goals), null);
});
