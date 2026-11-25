const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("public/app.js", "utf8");
const upgrade = fs.readFileSync("supabase/VIDEO_STUDIO_AI_PRODUCTION_UPGRADE.sql", "utf8");

test("project creation supports the current schema and legacy required prompt column", () => {
  assert.match(app, /\{name,description,user_id:user\.id\}/);
  assert.match(app, /\{name,description,prompt:description\|\|name,user_id:user\.id\}/);
  assert.match(app, /\{name,prompt:description\|\|name,user_id:user\.id\}/);
  assert.match(app, /23502/);
});

test("production upgrade adds description and relaxes the legacy prompt requirement", () => {
  assert.match(upgrade, /add column if not exists description text/i);
  assert.match(upgrade, /alter column prompt drop not null/i);
  assert.match(upgrade, /add column if not exists mime_type text/i);
  assert.match(upgrade, /add column if not exists asset_type text not null default 'image'/i);
});
