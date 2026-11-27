const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const context={window:{},Map,Promise,Error,Math,String,Array,Object};
vm.runInNewContext(require("node:fs").readFileSync("public/motion-engine.js","utf8"),context);
vm.runInNewContext(require("node:fs").readFileSync("public/film-renderer.js","utf8"),context);
test("registers the browser motion compositor and film renderer without invoking paid services",()=>{
 assert.equal(typeof context.window.VSAMotionEngine.draw,"function");
 assert.equal(typeof context.window.VSAFilmRenderer.renderFilm,"function");
});


test("film renderer requests all character dialogue voices in one quota-safe batch",()=>{
 const source=require("node:fs").readFileSync("public/film-renderer.js","utf8");
 assert.match(source,/action:"generate_speech_batch"/);
 assert.match(source,/item\.segment\.voiceAssignments\?\.\[item\.line\.character\]/);
 assert.match(source,/total>3500/);
 assert.match(source,/buffers\.size!==lines\.length/);
 assert.doesNotMatch(source,/action:"generate_speech"/);
});

test("long-film renderer uses real recorded ambience and peak-safe normalized dialogue",()=>{
 const source=require("node:fs").readFileSync("public/film-renderer.js","utf8");
 assert.match(source,/function cueMusicPluck/);
 assert.match(source,/let b0=0,b1=0,b2=0/);
 assert.match(source,/peak<\.002/);
 assert.match(source,/limiter\.threshold\.value=-10/);
 assert.match(source,/voiceCompressor\.ratio\.value=4/);
});


test("long-film ambience comes from the recorded sound library rather than synthetic noise",()=>{
 const source=require("node:fs").readFileSync("public/film-renderer.js","utf8");
 assert.match(source,/window\.VSANaturalAudio\.load/);
 assert.match(source,/natural\.play\(master,cue,segmentStart,duration,level\)/);
 assert.doesNotMatch(source,/cueNoise\(audioCtx,master/);
 assert.doesNotMatch(source,/cueMurmur\(audioCtx,master/);
});
