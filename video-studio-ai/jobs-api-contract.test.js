const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const jobs = fs.readFileSync("functions/api/jobs.js", "utf8");

test("Spanish speech generation uses the Cloudflare Workers AI Spanish TTS model", () => {
  assert.match(jobs, /@cf\/deepgram\/aura-2-es/);
  assert.match(jobs, /action==="generate_speech"/);
  assert.match(jobs, /encoding:"mp3"/);
  assert.match(jobs, /speechLanguage:"Spanish"/);
});

test("speech generation enforces bounded text and supported speakers", () => {
  assert.match(jobs, /MAX_SPEECH_TEXT=1200/);
  assert.match(jobs, /SPEAKERS\.has\(speaker\)/);
  assert.match(jobs, /invalid_speech_text/);
  assert.match(jobs, /invalid_speaker/);
});

test("speech and image generation never fall back to paid providers", () => {
  assert.match(jobs, /paidFallback:false/);
  assert.match(jobs, /No se intentó usar un proveedor de pago/);
  assert.match(jobs, /No se activó ningún proveedor de pago/);
});
