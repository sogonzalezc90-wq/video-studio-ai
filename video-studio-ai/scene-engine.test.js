const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync("public/scene-engine.js", "utf8"), context);
const engine = context.window.VSASceneEngine;

test("parses scenes, shots and Spanish dialogue", () => {
  const result = engine.analyze([
    "ESCENA 1 — EL SUEÑO",
    "Duración: 40 segundos.",
    "TOMA 1.1 — Circuito al amanecer",
    "Los tres hermanos observan un automóvil en la pista.",
    "Kiyoshima: Desde niño soñé con correr ahí.",
    "TOMA 1.2 — La promesa",
    "Kashymoto: Algún día vamos a estar en esa pista."
  ].join("\n"));
  assert.equal(result.total, 1);
  assert.equal(result.shotsTotal, 2);
  assert.equal(result.hasDialogue, true);
  assert.equal(result.scenes[0].dialogues.length, 2);
  assert.ok(result.scenes[0].types.includes("car"));
});

test("image prompt protects a requested automobile from motorcycle substitution", () => {
  const prompt = engine.buildImagePrompt({
    title: "El primer automóvil",
    description: "Los tres hermanos trabajan para comprar un automóvil de carreras."
  });
  assert.match(prompt, /AUTOMÓVIL de cuatro ruedas/);
  assert.match(prompt, /NO mostrar motocicletas/i);
});

test("does not force a motorcycle when the story requests one", () => {
  const prompt = engine.buildImagePrompt({
    title: "La motocicleta",
    description: "Una motocicleta cruza la carretera."
  });
  assert.match(prompt, /una motocicleta/i);
});

test("keeps separate scenes and extracts duration in minutes", () => {
  const result = engine.analyze([
    "ESCENA 1 — TALLER",
    "Duración: 1 minuto.",
    "Kiyoshima repara un motor.",
    "ESCENA 2 — CIRCUITO",
    "Duración: 30 segundos.",
    "Los hermanos observan la pista."
  ].join("\n"));
  assert.equal(result.total, 2);
  assert.equal(result.scenes[0].duration, 60);
  assert.equal(result.scenes[1].duration, 30);
});

test("builds a 20-minute production plan in segments no longer than 15 seconds", () => {
  const analysis = engine.analyze([
    "ESCENA 1 — TALLER",
    "TOMA 1.1 — Reparación",
    "Kiyoshima repara el automóvil.",
    "TOMA 1.2 — Preparativos",
    "Los hermanos preparan las herramientas.",
    "ESCENA 2 — CIRCUITO",
    "TOMA 2.1 — La carrera",
    "El automóvil acelera en la pista."
  ].join("\n"));
  const plan = engine.buildProductionPlan(analysis, 1200, 15);
  assert.equal(plan.targetSeconds, 1200);
  assert.equal(plan.scenes, 2);
  assert.ok(plan.totalSegments > 2);
  assert.ok(plan.segments.every(segment => segment.durationSeconds <= 15));
  const total = plan.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
  assert.equal(total, 1200);
  assert.equal(plan.segments[0].startSeconds, 0);
  assert.equal(plan.segments.at(-1).endSeconds, 1200);
});


test("includes visual prompts, dialogue and contextual audio cues in every production segment", () => {
  const analysis = engine.analyze([
    "ESCENA 1 — LA CARRERA",
    "TOMA 1.1 — El automóvil acelera",
    "Un automóvil rojo acelera por el circuito al amanecer. Se escucha el viento.",
    "Kiyoshima: ¡Vamos, tenemos que ganar!",
    "TOMA 1.2 — La frenada",
    "El automóvil frena antes de la curva."
  ].join("\n"));
  const plan = engine.buildProductionPlan(analysis, 30, 15);
  assert.equal(plan.totalSegments, 2);
  const first = plan.segments[0];
  assert.match(first.visualPrompt, /automóvil/i);
  assert.equal(first.dialogues.length, 1);
  assert.equal(first.dialogues[0].character, "Kiyoshima");
  assert.ok(first.audioCues.includes("motor_automovil"));
  assert.ok(first.audioCues.includes("viento_ambiente"));
  assert.ok(!plan.segments[1].audioCues.includes("viento_ambiente"));
  assert.equal(first.sceneIndex, 0);
  assert.equal(first.shotIndex, 0);
  assert.equal(first.endSeconds - first.startSeconds, 15);
  assert.ok(plan.segments.every(segment => segment.visualPrompt && Array.isArray(segment.audioCues)));
});
