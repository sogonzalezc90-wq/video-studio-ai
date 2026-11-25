const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const ui=fs.readFileSync("public/production-ui.js","utf8");
const engine=fs.readFileSync("public/production-engine.js","utf8");
const app=fs.readFileSync("public/app.js","utf8");
test("production workspace requires a destination project and creates segment manifests",()=>{
 assert.match(ui,/generation-project/);
 assert.match(ui,/Selecciona primero el proyecto destino/);
 assert.match(ui,/createManifest/);
 assert.match(ui,/saveManifest/);
});
test("segments can be assigned private image, environment and character references",()=>{
 assert.match(ui,/makeAssetSelect\("Imagen de fondo de esta toma","image"\)/);
 assert.match(ui,/makeAssetSelect\("Clip de video \(opcional\)","video"\)/);
 assert.match(ui,/Capa PNG transparente/);
 assert.match(ui,/VSAFilmRenderer\.renderFilm/);
 assert.match(ui,/makeAssetSelect\("Escenario \/ locación","environment"\)/);
 assert.match(engine,/assignAsset/);
 assert.match(engine,/storagePath:asset\.storagePath/);
 assert.match(app,/vsa-assets-loaded/);
});


test("long-film creation prepares a matching manifest and all missing master images before queueing", () => {
  assert.match(ui, /window\.VSAEnsureFilmReadyAndQueue=async function/);
  assert.match(ui, /await generateSegmentImages\(manifest,generateButton,status\)/);
  assert.match(ui, /stillMissing\.length/);
  assert.match(ui, /queueButton\.click\(\)/);
});
