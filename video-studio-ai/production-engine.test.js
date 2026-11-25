const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const context={window:{},Date,Map,Set,Promise,Error,Math,String,Array,Object};
vm.runInNewContext(fs.readFileSync("public/scene-engine.js","utf8"),context);
vm.runInNewContext(fs.readFileSync("public/production-engine.js","utf8"),context);
const scene=context.window.VSASceneEngine,engine=context.window.VSAProductionEngine;
function sample(){
 return scene.analyze(["ESCENA 1 — TALLER","TOMA 1.1 — Reparación","Kiyoshima repara el automóvil.","Kiyoshima: Ya casi terminamos.","TOMA 1.2 — Preparativos","Kiyoshima prepara el automóvil.","ESCENA 2 — CIRCUITO","TOMA 2.1 — Carrera","El automóvil acelera."].join("\n"));
}
test("creates stable 15-second segments and a complete 20-minute timeline",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:1200,maxSegmentSeconds:15});
 assert.ok(manifest.totalSegments>1);
 assert.equal(manifest.segments[0].id,"seg-0001");
 assert.equal(manifest.segments.at(-1).endSeconds,1200);
 assert.ok(manifest.segments.every(segment=>segment.durationSeconds===15));
 assert.equal(engine.validateManifest(manifest).valid,true);
});
test("keeps short tests at the selected duration and separates them from 20-minute films",()=>{
 const analysis=sample();
 const short=engine.createManifest(analysis,{durationSeconds:30,maxSegmentSeconds:15});
 const long=engine.createManifest(analysis,{durationSeconds:1200,maxSegmentSeconds:15});
 assert.equal(short.targetSeconds,30);
 assert.equal(short.segments.at(-1).endSeconds,30);
 assert.equal(long.targetSeconds,1200);
 assert.equal(long.segments.at(-1).endSeconds,1200);
 assert.ok(long.totalSegments>short.totalSegments);
 assert.equal(engine.validateManifest(short).valid,true);
 assert.equal(engine.validateManifest(long).valid,true);
});
test("assigns per-character voices to every dialogue in that character's segments",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15});
 engine.assignVoice(manifest,"Kiyoshima","alvaro");
 assert.ok(manifest.segments.filter(s=>s.dialogues.some(d=>d.character==="Kiyoshima")).every(s=>s.voiceAssignments.Kiyoshima==="alvaro"));
 assert.throws(()=>engine.assignVoice(manifest,"Kiyoshima","not-a-voice"),/no está permitida/);
});
test("stores editable appearance and wardrobe profiles for any character",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15});
 const profile=engine.addCharacter(manifest,"Amara","Mujer adulta, cabello rizado oscuro, chaqueta verde y botas negras.");
 assert.equal(profile.description,"Mujer adulta, cabello rizado oscuro, chaqueta verde y botas negras.");
 engine.updateCharacterProfile(manifest,"Amara","Mujer adulta, cabello corto oscuro, abrigo azul y botas negras.");
 assert.match(manifest.characters.find(item=>item.name==="Amara").description,/abrigo azul/);
});
test("attaches image, character and environment references to a segment",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15});
 const id=manifest.segments[0].id;
 engine.assignAsset(manifest,id,"image",{id:"asset-image-1",name:"Toma base"});
 engine.assignAsset(manifest,id,"character",{id:"asset-char-1",character:"Kiyoshima"});
 engine.assignAsset(manifest,id,"environment",{id:"asset-env-1",name:"Taller"});
 assert.equal(manifest.segments[0].assets.image.id,"asset-image-1");
 assert.equal(manifest.segments[0].references.characters[0].character,"Kiyoshima");
 assert.equal(manifest.segments[0].references.environment.id,"asset-env-1");
});
test("assigns dialogue written before the first shot to that shot",()=>{
 const parsed=scene.analyze(["ESCENA 1 — TALLER","Kiyoshima: Ya casi terminamos.","TOMA 1.1 — Reparación","Kiyoshima repara el automóvil."].join("\n"));
 assert.equal(parsed.scenes[0].dialogues.length,1);
 assert.equal(parsed.scenes[0].shots[0].dialogues.length,1);
 assert.equal(parsed.scenes[0].shots[0].dialogues[0].text,"Ya casi terminamos.");
});
test("inherits references only across consecutive shots in the same scene",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:60,maxSegmentSeconds:15});
 const first=manifest.segments[0],second=manifest.segments[1];
 engine.assignAsset(manifest,first.id,"environment",{id:"env-1"});
 engine.assignAsset(manifest,first.id,"character",{id:"char-1",character:"Kiyoshima"});
 engine.resolveContinuity(manifest);
 assert.equal(second.references.environment.id,"env-1");
 assert.equal(second.references.characters[0].id,"char-1");
 const otherScene=manifest.segments.find(s=>s.sceneIndex===1);
 assert.notEqual(otherScene.references.environment?.id,"env-1");
 const secondShotInOtherScene=manifest.segments.find(s=>s.sceneIndex===1&&s.order>otherScene.order);
 if(secondShotInOtherScene){
   assert.equal(secondShotInOtherScene.references.characters.some(ref=>ref.id==="char-1"),false);
   assert.notEqual(secondShotInOtherScene.references.environment?.id,"env-1");
 }
});
test("enforces valid segment state transitions and export readiness",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15});
 const first=manifest.segments[0];
 assert.throws(()=>engine.transition(manifest,first.id,"approved"),/Transición no permitida/);
 engine.assignAsset(manifest,first.id,"image",{id:"image-1"});
 assert.throws(()=>engine.buildExportTimeline(manifest),/no está lista para exportar/);
 manifest.segments.slice(1).forEach((segment,index)=>engine.assignAsset(manifest,segment.id,"image",{id:"image-"+(index+2)}));
 assert.throws(()=>engine.buildExportTimeline(manifest),/clip de video real/);
 manifest.segments.forEach((segment,index)=>engine.assignAsset(manifest,segment.id,"video",{id:"video-"+(index+1),storagePath:"clips/"+(index+1)+".mp4",type:"video"}));
 assert.equal(engine.buildExportTimeline(manifest).length,manifest.totalSegments);
 engine.transition(manifest,first.id,"rendering");
 engine.transition(manifest,first.id,"rendered");
 engine.transition(manifest,first.id,"approved");
 assert.equal(first.status,"approved");
});

test("supports arbitrary user-defined casts without fixed story characters",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15,characters:["Amara","Detective Ruiz","Robot 7"]});
 assert.equal(manifest.characters.length,4);
 assert.ok(manifest.characters.some(item=>item.name==="Amara"));
 assert.ok(manifest.characters.some(item=>item.name==="Detective Ruiz"));
 assert.ok(manifest.characters.some(item=>item.name==="Robot 7"));
 engine.assignVoice(manifest,"Robot 7","javier");
 assert.equal(manifest.characters.find(item=>item.name==="Robot 7").voice,"ald");
});

test("creates exact 30-second segments through a 20-minute film",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:1200,maxSegmentSeconds:30});
 assert.equal(manifest.totalSegments,40);
 assert.ok(manifest.segments.every(segment=>segment.durationSeconds===30));
 assert.equal(manifest.segments.at(-1).endSeconds,1200);
 assert.equal(engine.validateManifest(manifest).valid,true);
});
test("rejects film durations that cannot be divided into exact selected segments",()=>{
 assert.throws(()=>engine.createManifest(sample(),{durationSeconds:100,maxSegmentSeconds:30}),/múltiplo exacto/);
 assert.throws(()=>engine.createManifest(sample(),{durationSeconds:1201,maxSegmentSeconds:15}),/20 minutos/);
});

test("places each shot dialogue in only one segment even when the shot spans many segments",()=>{
 const parsed=scene.analyze(["ESCENA 1 — TALLER","TOMA 1.1 — Reparación","Kiyoshima: Ya casi terminamos.","Kiyoshima repara el automóvil."].join("\n"));
 const manifest=engine.createManifest(parsed,{durationSeconds:120,maxSegmentSeconds:15});
 const dialogueSegments=manifest.segments.filter(segment=>segment.dialogues.some(line=>line.text==="Ya casi terminamos."));
 assert.equal(dialogueSegments.length,1);
});

test("keeps dialogue from every short shot when several shots share one fixed segment",()=>{
 const story=[
  "ESCENA 1 — TALLER",
  "TOMA 1.1 — Kiyoshima abre el cofre",
  "Kiyoshima: Vamos a revisar el motor.",
  "Kiyoshima abre el cofre del automóvil.",
  "TOMA 1.2 — Kashymoto alcanza una herramienta",
  "Kashymoto: Aquí tienes la llave.",
  "Kashymoto entrega una herramienta.",
  "TOMA 1.3 — Keriko revisa los datos",
  "Keriko: La temperatura está subiendo.",
  "Keriko observa el indicador."
 ].join("\n");
 const parsed=scene.analyze(story);
 const manifest=engine.createManifest(parsed,{durationSeconds:15,maxSegmentSeconds:15});
 assert.equal(manifest.totalSegments,1);
 const spoken=manifest.segments[0].dialogues.map(line=>line.text);
 assert.equal(spoken.join("|"),["Vamos a revisar el motor.","Aquí tienes la llave.","La temperatura está subiendo."].join("|"));
 assert.match(manifest.segments[0].visualPrompt,/Kiyoshima abre el cofre/);
 assert.match(manifest.segments[0].visualPrompt,/Kashymoto entrega una herramienta/);
});

test("does not treat generated still images as completed video segments",()=>{
 const manifest=engine.createManifest(sample(),{durationSeconds:30,maxSegmentSeconds:15});
 manifest.segments.forEach((segment,index)=>engine.assignAsset(manifest,segment.id,"image",{id:"still-"+index}));
 const result=engine.validateManifest(manifest,{requireVideo:true});
 assert.equal(result.valid,false);
 assert.ok(result.errors.some(error=>error.includes("falta un clip de video real")));
 assert.throws(()=>engine.buildExportTimeline(manifest),/clip de video real/);
});

test("stores a segment-relative timestamp for each dialogue line",()=>{
 const parsed=scene.analyze(["ESCENA 1 — TALLER","TOMA 1.1 — Reparación","Kiyoshima: Ya casi terminamos.","Kiyoshima repara el automóvil."].join("\n"));
 const plan=scene.buildProductionPlan(parsed,30,15);
 const line=plan.segments.flatMap(segment=>segment.dialogues.map(dialogue=>({segment,dialogue}))).find(item=>item.dialogue.text==="Ya casi terminamos.");
 assert.ok(line);
 assert.ok(Number.isFinite(line.dialogue.atSeconds));
 assert.ok(line.dialogue.atSeconds>=0&&line.dialogue.atSeconds<=line.segment.durationSeconds);
});
