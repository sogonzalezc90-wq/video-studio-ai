const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const maker = fs.readFileSync("public/video-maker.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

test("video renderer converts all detected dialogue into one quota-aware Spanish voice track", () => {
  assert.match(maker, /loadDialogueVoices/);
  assert.match(maker, /action:"generate_speech"/);
  assert.match(maker, /decodeAudioData/);
  assert.match(maker, /source\.start\(/);
  assert.match(maker, /dialogueRows=scenes\.flatMap/);
  assert.match(maker, /join\(" … "\)/);
  assert.match(maker, /video-voice/);
  assert.match(maker, /Se alcanzó la cuota gratuita diaria de voz/);
});

test("speech requests use the authenticated Supabase session", () => {
  assert.match(app, /VSAGetSessionToken/);
  assert.match(maker, /VSAGetSessionToken/);
  assert.match(maker, /"authorization":"Bearer "\+token/);
});

test("the studio exposes a selectable Spanish dialogue voice", () => {
  assert.match(html, /id="video-voice"/);
  assert.match(html, /value="alvaro"/);
  assert.match(html, /value="carina"/);
});


test("Create Video runs the long-film preparation workflow instead of directly clicking the queue", () => {
  assert.match(maker, /VSAEnsureFilmReadyAndQueue/);
  assert.match(maker, /await window\.VSAEnsureFilmReadyAndQueue\(\)/);
});
