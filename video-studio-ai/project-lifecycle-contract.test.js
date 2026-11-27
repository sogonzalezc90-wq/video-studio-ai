const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const upgrade = fs.readFileSync("supabase/VIDEO_STUDIO_AI_PRODUCTION_UPGRADE.sql", "utf8");

test("project cards expose an owner-scoped delete action", () => {
  assert.ok(app.includes('removeButton.textContent="Eliminar proyecto"'));
  assert.ok(app.includes("deleteProject(p,removeButton)"));
  assert.ok(app.includes('.eq("id",project.id).eq("user_id",user.id)'));
  assert.ok(app.includes("¿Eliminar definitivamente el proyecto"));
});

test("project deletion protects active video jobs and removes all project media", () => {
  assert.ok(app.includes('new Set(["queued","processing","assembling","cancelling"])'));
  assert.ok(app.includes("sb.storage.from(bucket).remove(batch)"));
  assert.ok(app.includes('removeInBatches("video-assets",assetPaths)'));
  assert.ok(app.includes('removeInBatches("video-renders",[...renderPaths])'));
  assert.ok(app.includes("renderBucket.list(folder,{limit:1000})"));
  assert.ok(app.includes('from("video_jobs").delete()'));
  assert.ok(app.includes('from("production_manifests").delete()'));
  assert.ok(app.includes('from("project_assets").delete()'));
  assert.ok(app.includes('from("projects").delete()'));
});

test("project creation verifies the saved row before reporting success", () => {
  assert.ok(app.includes('.from("projects").insert(attempt.record)'));
  assert.ok(app.includes("refreshed.some(project=>project.id===savedProject.id)"));
  assert.ok(app.includes("Proyecto creado, guardado y verificado en tu biblioteca"));
});

test("production SQL limits project and asset metadata to authenticated users", () => {
  assert.match(upgrade, /revoke all privileges on table public\.projects, public\.project_assets from public, anon/i);
  assert.match(upgrade, /grant select, insert, update, delete on table public\.projects to authenticated/i);
  assert.match(upgrade, /grant select, insert, delete on table public\.project_assets to authenticated/i);
});

test("production HTML points to the project lifecycle assets", () => {
  assert.ok(html.includes("/app.js?v=20261127-audio5"));
});
