const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const schema = fs.readFileSync("supabase/schema.sql", "utf8");

test("asset records support image and video classification on fresh and existing databases", () => {
  assert.match(schema, /asset_type text not null default 'image'/i);
  assert.match(schema, /add column if not exists asset_type text not null default 'image'/i);
  assert.match(schema, /add column if not exists mime_type text/i);
});

test("upgrades existing project tables used by the current application", () => {
  assert.match(schema, /add column if not exists description text/i);
  assert.match(schema, /alter column prompt drop not null/i);
});

test("asset library has an index for project chronology", () => {
  assert.match(schema, /project_assets_project_created_idx/i);
});
