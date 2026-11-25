const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const migration = fs.readFileSync("supabase/migrations/202611190001_video_jobs.sql", "utf8");
const api = fs.readFileSync("functions/api/jobs.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

test("Supabase migration exposes every RPC used by the Kaggle queue worker", () => {
  assert.match(migration, /function public\.claim_next_video_job\(\)/i);
  assert.match(migration, /function public\.fail_exhausted_video_jobs\(\)/i);
  assert.match(migration, /grant execute on function public\.claim_next_video_job\(\) to service_role/i);
  assert.match(migration, /grant execute on function public\.fail_exhausted_video_jobs\(\) to service_role/i);
});

test("queue schema supports the cancellation state and owner-scoped cancellation RPC", () => {
  assert.match(migration, /'cancelling'/i);
  assert.match(migration, /function public\.cancel_video_job\(p_job_id uuid\)/i);
  assert.match(migration, /grant execute on function public\.cancel_video_job\(uuid\) to authenticated/i);
});

test("authenticated users can delete only their own inactive jobs and render objects", () => {
  assert.match(migration, /grant select, insert, delete on public\.video_jobs to authenticated/i);
  assert.match(migration, /Users can delete their own inactive video jobs/i);
  assert.match(migration, /Users can delete their own rendered videos/i);
});

test("Cloudflare Pages Function and production UI share the cancellation contract", () => {
  assert.match(api, /rpc\/cancel_video_job/i);
  assert.match(api, /action==="cancel"/i);
  assert.match(app, /cancelWanJob/i);
  assert.match(app, /action:"cancel"/i);
  assert.match(app, /cancelling:"Deteniendo proceso/i);
});
