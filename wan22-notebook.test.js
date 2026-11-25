const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const notebook = JSON.parse(fs.readFileSync("notebooks/wan22_kaggle_free.ipynb", "utf8"));
const cells = notebook.cells || [];
const source = cells.map(cell => (cell.source || []).join("")).join("\n");
const code = cells.filter(cell => cell.cell_type === "code")
  .map(cell => (cell.source || []).join(""))
  .join("\n");

test("Wan 2.2 Kaggle notebook is a valid executable Jupyter notebook", () => {
  assert.equal(notebook.nbformat, 4);
  assert.ok(cells.length >= 10);
  assert.ok(cells.filter(cell => cell.cell_type === "code").length >= 6);
  for (const cell of cells.filter(cell => cell.cell_type === "code")) {
    assert.ok(Array.isArray(cell.source), "Notebook code source must be an array of lines");
  }
});

test("Wan 2.2 notebook uses the official model components and ComfyUI API graph", () => {
  assert.match(code, /wan2\.2_ti2v_5B_fp16\.safetensors/);
  assert.match(code, /umt5_xxl_fp8_e4m3fn_scaled\.safetensors/);
  assert.match(code, /wan2\.2_vae\.safetensors/);
  assert.match(code, /Wan22ImageToVideoLatent/);
  assert.match(code, /ModelSamplingSD3/);
  assert.match(code, /SaveVideo/);
  assert.match(code, /\/prompt/);
  assert.match(code, /\/history\//);
});

test("Kaggle ComfyUI stays on loopback and notebook does not use paid cloud or privileged secrets", () => {
  assert.match(code, /127\.0\.0\.1/);
  assert.doesNotMatch(source, /cloud\.comfy\.org|COMFY_API_KEY|ngrok|cloudflared|SUPABASE_SERVICE_ROLE|service_role/i);
  assert.match(source, /No pegues claves de Supabase/);
});

test("first validation render is bounded and produces a downloadable MP4", () => {
  assert.match(code, /height':352/);
  assert.match(code, /length':49/);
  assert.match(code, /width':640/);
  assert.match(code, /steps':12/);
  assert.match(code, /VIDEO_STUDIO_AI_Wan22_test\.mp4/);
});
