const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const upgrade = fs.readFileSync("supabase/VIDEO_STUDIO_AI_PRODUCTION_UPGRADE.sql", "utf8");

test("project cards expose an owner-scoped delete action", () => {
  assert.match(app, /removeButton\.textContent="Eliminar proyecto"/);
  assert.match(app, /deleteProject\(p,removeButton\)/);
  assert.match(app, /\.eq\("id",project\.id\)\.eq\("user_id",user\.id\)/);
  assert.match(app, /¿Eliminar definitivamente el proyecto/);
});

test("project deletion protects active video jobs and removes related private media", () => {
  assert.match(app, /new Set\(\["queued","processing","assembling","cancelling"\]\)/);
  assert.match(app, /storage\.from\("video-assets"\)\.remove/);
  assert.match(app, /storage\.from\("video-renders"\)\.remove/);
  assert.match(app, /from\("video_jobs"\)\.delete\(\)/);
  assert.match(app, /from\("production_manifests"\)\.delete\(\)/);
  assert.match(app, /from\("project_assets"\)\.delete\(\)/);
  assert.match(app, /from\("projects"\)\.delete\(\)/);
});

test("project creation verifies the saved row before reporting success", () => {
  assert.match(app, /\.from\("projects"\)\.insert\(attempt\.record\)/);
  assert.match(app, /refreshed\.some\(project=>project\.id===savedProject\.id\)/);
  assert.match(app, /Proyecto creado, guardado y verificado en tu biblioteca/);
});

test("production SQL limits project and asset metadata to authenticated users", () => {
  assert.match(upgrade, /revoke all privileges on table public\.projects, public\.project_assets from public, anon/i);
  assert.match(upgrade, /grant select, insert, update, delete on table public\.projects to authenticated/i);
  assert.match(upgrade, /grant select, insert, delete on table public\.project_assets to authenticated/i);
});
