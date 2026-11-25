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
