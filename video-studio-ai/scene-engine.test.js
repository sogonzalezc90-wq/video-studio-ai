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


test("recognizes every requested production location and keeps its ambience on shots", () => {
  const examples = [
    ["Zoológico", "ambiente_zoologico"],
    ["Consultorio médico", "ambiente_consultorio"],
    ["Mercado", "ambiente_mercado"],
    ["Plaza comercial", "ambiente_plaza_comercial"],
    ["Cafetería", "ambiente_cafeteria"],
    ["Restaurante", "ambiente_restaurante"],
    ["Autódromo y pista de carreras", "ambiente_autodromo"],
    ["Calle y avenida", "ambiente_calle"],
    ["Biblioteca", "ambiente_biblioteca"],
    ["Escuela", "ambiente_escuela"],
    ["Museo", "ambiente_museo"],
    ["Hotel", "ambiente_hotel"],
    ["Iglesia", "ambiente_iglesia"],
    ["Parque", "ambiente_parque"],
    ["Piscina", "ambiente_piscina"],
    ["Autobús", "ambiente_autobus"],
    ["Construcción", "ambiente_construccion"],
    ["Teatro", "ambiente_teatro"],
    ["Gimnasio", "ambiente_gimnasio"]
  ];
  examples.forEach(([location, cue], index) => {
    const result = engine.analyze([
      `ESCENA ${index + 1} — ${location.toUpperCase()}`,
      `TOMA ${index + 1}.1 — Actividad principal`,
      "Una persona camina por el lugar y observa el entorno."
    ].join("\\n"));
    const plan = engine.buildProductionPlan(result, 15, 15);
    assert.ok(result.scenes[0].types.length > 0, location + " debe clasificarse");
    assert.ok(plan.segments[0].audioCues.includes(cue), location + " debe conservar su ambiente en la toma");
  });
});

test("recognizes animal, medical, shopping, kitchen and transport sound actions", () => {
  const result = engine.analyze([
    "ESCENA 1 — ZOOLÓGICO",
    "TOMA 1.1 — Los animales",
    "Los leones rugen, los monos gritan y los pájaros cantan.",
    "ESCENA 2 — CONSULTORIO",
    "TOMA 2.1 — Monitor",
    "El monitor cardíaco emite pitidos y suena una alarma.",
    "ESCENA 3 — MERCADO",
    "TOMA 3.1 — Cobro",
    "La cajera escanea productos y mueve un carrito de compras.",
    "ESCENA 4 — RESTAURANTE",
    "TOMA 4.1 — Cocina",
    "El chef fríe alimentos en una sartén y sirve platos.",
    "ESCENA 5 — AEROPUERTO",
    "TOMA 5.1 — Despegue",
    "Un avión despega mientras un tren llega a la terminal."
  ].join("\\n"));
  const cues = result.scenes.flatMap(scene => engine.buildProductionPlan({scenes:[scene],globalInstructions:""},15,15).segments[0].audioCues);
  ["animales","aves","equipo_medico","alarma","caja_registradora","carritos_compras","cocina","aeropuerto","tren_metro"].forEach(cue => assert.ok(cues.includes(cue), cue + " debe estar disponible"));
});


test("recognizes screenplay dialogue with em dash and narrated quotation forms", () => {
  const result = engine.analyze([
    "ESCENA 1 — CONVERSACIÓN",
    "TOMA 1.1 — Los hermanos hablan",
    "— Kiyoshima — «Tenemos que trabajar juntos.»",
    "Kashymoto dice: «¡Yo me encargo!»"
  ].join("\n"));
  assert.equal(result.hasDialogue, true);
  assert.equal(result.scenes[0].dialogues.length, 2);
  assert.equal(result.scenes[0].dialogues[0].character, "Kiyoshima");
  assert.equal(result.scenes[0].dialogues[1].character, "Kashymoto");
});

test("exposes the current audio engine version", () => {
  assert.equal(engine.audioVersion, "20261127-natural1");
});

test("short-video engine loads recorded ambience and does not synthesize environmental noise", () => {
  const source = fs.readFileSync("public/scene-engine.js", "utf8");
  assert.match(source, /function addMusicPluck/);
  assert.match(source, /async function buildAudio/);
  assert.match(source, /await window\.VSANaturalAudio\.load/);
  assert.match(source, /natural\.play\(master,cue,when,len,ambienceLevel\)/);
  assert.match(source, /compressor\.threshold\.value=-12/);
  assert.match(source, /audioVersion:"20261127-natural1"/);
  assert.doesNotMatch(source, /if\(s\.types\.includes\("rain"\)\)noise/);
});

test("natural sound library exposes real recorded files for core scene cues", () => {
  const library = fs.readFileSync("public/natural-audio.js", "utf8");
  assert.match(library, /rain: "\/audio\/rain\.ogg"/);
  assert.match(library, /cafe: "\/audio\/cafe\.ogg"/);
  assert.match(library, /engine: "\/audio\/engine\.ogg"/);
  assert.match(library, /city: "\/audio\/city\.ogg"/);
  assert.match(library, /footsteps: "\/audio\/footsteps\.ogg"/);
  assert.match(library, /decodeAudioData/);
});
