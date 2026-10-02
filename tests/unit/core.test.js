// Núcleo de datos: normalizar, migrar datos viejos y combinar dos dispositivos.
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../js/core.js");
const { normalize, mergeStates, nextDueFrom, dayKey, splitGoalTitle } = core;

test("el día empieza a las 5: lo hecho a la 1 de la mañana cuenta para el día anterior", () => {
  assert.equal(dayKey(new Date("2026-10-05T01:00:00-03:00")), "2026-10-04");
  assert.equal(dayKey(new Date("2026-10-05T06:00:00-03:00")), "2026-10-05");
});

test("las repetidas vuelven a las 5 del día siguiente (o en 2 / 7 días)", () => {
  const at = new Date("2026-10-05T00:30:00-03:00").getTime(); // todavía es «el 4»
  assert.equal(new Date(nextDueFrom("daily", at)).toISOString(), new Date("2026-10-05T05:00:00-03:00").toISOString());
  assert.equal(new Date(nextDueFrom("every2", at)).toISOString(), new Date("2026-10-06T05:00:00-03:00").toISOString());
  assert.equal(new Date(nextDueFrom("weekly", at)).toISOString(), new Date("2026-10-11T05:00:00-03:00").toISOString());
});

test("migra la meta única vieja a la lista de metas, con sus tareas y sin emoji repetido", () => {
  const s = normalize({ goalTitle: "La Playa 🏖️", goalDate: "2026-10-10", tasks: [
    { id: "a", text: "Armar valija" }, { id: "b", text: "Renovar licencia", later: true }, { id: "c", text: "Medicar", repeat: "daily" }] });
  assert.equal(s.goals.length, 1);
  assert.deepEqual([s.goals[0].emoji, s.goals[0].title, s.goals[0].date], ["🏖️", "La Playa", "2026-10-10"]);
  assert.deepEqual(s.tasks.map(t => t.goal), ["g-legacy", "", ""]);
  assert.equal(s.goalTitle, "");
});

test("splitGoalTitle saca el emoji del nombre y lo usa como ícono", () => {
  assert.deepEqual(splitGoalTitle("Mudanza 📦", "🎯"), { title: "Mudanza", emoji: "📦" });
  assert.deepEqual(splitGoalTitle("Estudio médico", "🩺"), { title: "Estudio médico", emoji: "🩺" });
});

test("datos inválidos se corrigen en vez de romper la app", () => {
  const s = normalize({ tasks: [{ text: "x", cat: "inventada", size: "xl", due: "mañana", repeat: "anual" }, { nope: 1 }], goals: "no" });
  assert.equal(s.tasks.length, 1);
  assert.deepEqual([s.tasks[0].cat, s.tasks[0].size, s.tasks[0].due, s.tasks[0].repeat], ["otros", "m", "", ""]);
  assert.deepEqual(s.goals, []);
});

const base = () => normalize({ tasks: [{ id: "t1", text: "Llamar al gasista", cat: "casa" }, { id: "t2", text: "Pagar expensas", cat: "casa" }],
  goals: [{ id: "g1", title: "La Playa", emoji: "🏖️", date: "2026-10-10" }] });

test("combinar: lo hecho en un dispositivo no se pierde y los puntos se suman", () => {
  const phone = base(), laptop = base();
  Object.assign(phone.tasks[0], { done: true, doneAt: 1000, earned: 15 }); phone.earned = 15;
  Object.assign(laptop.tasks[1], { done: true, doneAt: 2000, earned: 25 }); laptop.earned = 25;
  const m = mergeStates(phone, laptop);
  assert.deepEqual(m.tasks.map(t => t.done), [true, true]);
  assert.equal(m.earned, 40);
});

test("combinar: si se editó la misma tarea en los dos lados, gana la edición más reciente", () => {
  const phone = base(), laptop = base();
  Object.assign(phone.tasks[0], { text: "Llamar al gasista (urgente)", editedAt: 2000 });
  Object.assign(laptop.tasks[0], { text: "Llamar al gasista Juan", editedAt: 1000 });
  assert.equal(mergeStates(phone, laptop).tasks[0].text, "Llamar al gasista (urgente)");
  assert.equal(mergeStates(laptop, phone).tasks[0].text, "Llamar al gasista (urgente)");
});

test("combinar: lo borrado no resucita y las metas borradas tampoco", () => {
  const phone = base(), laptop = base();
  phone.tasks = phone.tasks.filter(t => t.id !== "t2"); phone.deleted.push("t2");
  phone.goals = []; phone.deleted.push("g1");
  laptop.tasks[0].goal = "g1";
  const m = mergeStates(phone, laptop);
  assert.deepEqual(m.tasks.map(t => t.id), ["t1"]);
  assert.equal(m.goals.length, 0);
  assert.equal(m.tasks[0].goal, "");
});

test("combinar: las metas nuevas y lo aprendido de los dos lados se juntan", () => {
  const phone = base(), laptop = base();
  laptop.goals.push({ id: "g2", title: "Estudio médico", emoji: "🩺", date: "2026-10-25", cleared: 0, createdAt: 0 });
  phone.learned.cat.celina = "trabajo"; laptop.learned.size.averiguar = "m";
  const m = mergeStates(phone, laptop);
  assert.deepEqual(m.goals.map(g => g.id).sort(), ["g1", "g2"]);
  assert.equal(m.learned.cat.celina, "trabajo");
  assert.equal(m.learned.size.averiguar, "m");
});
