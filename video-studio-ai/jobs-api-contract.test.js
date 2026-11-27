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


test("FLUX 2 Klein text-to-image requests use multipart input, not JSON", () => {
  assert.match(jobs, /FLUX\.2 Klein 4B accepts multipart input only/);
  assert.match(jobs, /form\.set\("prompt",strengthenPrompt\(prompt\)\)/);
  assert.match(jobs, /multipart:\s*\{\s*body:multipartRequest\.body/);
  assert.doesNotMatch(jobs, /env\.AI\.run\(IMAGE_MODEL,\{prompt:strengthenPrompt\(prompt\),width:1024,height:576\}\)/);
});


test("film speech batches multiple character voices under one daily free quota reservation", () => {
  assert.match(jobs, /action==="generate_speech_batch"/);
  assert.match(jobs, /MAX_SPEECH_BATCH_CHARS=3500/);
  assert.match(jobs, /rows\.length>40/);
  assert.match(jobs, /reserveFreeAiQuota\(speechAuth,"speech"\)/);
  assert.match(jobs, /workers-ai-free-allocation-only/);
  assert.match(jobs, /speech_batch_too_large/);
});
