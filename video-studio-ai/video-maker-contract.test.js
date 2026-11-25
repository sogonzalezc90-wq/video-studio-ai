const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const maker = fs.readFileSync("public/video-maker.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");

test("video renderer requests Spanish speech for detected dialogue", () => {
  assert.match(maker, /loadDialogueVoices/);
  assert.match(maker, /action:"generate_speech"/);
  assert.match(maker, /decodeAudioData/);
  assert.match(maker, /source\.start\(/);
  assert.match(maker, /analysis\.hasDialogue/);
  assert.match(maker, /VSAActiveManifest\?\.characters/);
  assert.match(maker, /character=>character\.name===item\.character/);
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
