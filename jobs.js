const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" }
});

function config(request, env) {
  // Use the same public Supabase project credentials already used by the signed-in app.
  // Read the same public project credentials used by the signed-in browser.
  const headerUrl = request.headers.get("x-supabase-url") || "";
  const headerKey = request.headers.get("apikey") || "";
  const url = headerUrl.replace(/\/$/, "");
  const key = headerKey;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !key) {
    throw new Error("La URL y la clave pública deben corresponder al mismo proyecto Supabase conectado en la aplicación.");
  }
  return { url, key };
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return { error: json({ ok: false, error: "unauthorized", message: "Inicia sesión para consultar tus trabajos." }, 401) };
  const { url, key } = config(request, env);
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${token}` }
  });
  if (!response.ok) return { error: json({ ok: false, error: "invalid_session", message: "La sesión no es válida o expiró." }, 401) };
  return { user: await response.json(), token, url, key };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await currentUser(request, env);
    if (auth.error) return auth.error;
    const response = await fetch(
      `${auth.url}/rest/v1/video_jobs?select=id,project_id,duration_seconds,segment_seconds,total_segments,status,progress,completed_segments,output_path,error_message,created_at,updated_at&user_id=eq.${encodeURIComponent(auth.user.id)}&order=created_at.desc&limit=50`,
      { headers: { apikey: auth.key, authorization: `Bearer ${auth.token}` } }
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok) return json({ ok: false, error: "jobs_query_failed", message: "No se pudieron consultar los trabajos.", details: rows }, response.status);
    for (const job of rows) {
      if (job.status === "completed" && job.output_path) {
        const signed = await fetch(`${auth.url}/storage/v1/object/sign/video-renders/${job.output_path.split("/").map(encodeURIComponent).join("/")}`, {
          method: "POST",
          headers: { apikey: auth.key, authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: 3600 })
        });
        if (signed.ok) {
          const data = await signed.json();
          job.download_url = data.signedURL?.startsWith("http") ? data.signedURL : `${auth.url}/storage/v1${data.signedURL}`;
        }
      }
    }
    return json({ ok: true, ready: true, status: "queue_connected", label: "Cola Supabase conectada", jobs: rows });
  } catch (error) {
    return json({ ok: false, error: "server_configuration_error", message: error.message }, 500);
  }
}

async function createOptionalDialogueScript(prompt, durationSeconds, env) {
  // Disabled by default to preserve the zero-cost requirement. Enable explicitly
  // only after confirming the account and daily free allocation; paid overage is possible on Workers Paid.
  if (env.VSA_ENABLE_AI_DIALOGUE !== "true" || !env.AI?.run) return null;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.2-1b-instruct", {
      messages: [
        {
          role: "system",
          content: "Eres guionista de doblaje en español latino mexicano. Crea diálogos breves y naturales para una historia audiovisual. Devuelve exclusivamente JSON válido con la forma {\"dialogues\":[{\"speaker\":\"nombre exacto de personaje\",\"text\":\"frase hablada\",\"position\":0.0}]}. Usa solo personajes cuyo nombre aparezca en el texto. No inventes personajes, lugares, sucesos ni cambies el desenlace. Las frases deben corresponder a lo que la historia permite inferir. Máximo 18 intervenciones, máximo 180 caracteres cada una. position es un número de 0 a 1 que indica el momento de la película. No incluyas narración técnica ni instrucciones de cámara."
        },
        {
          role: "user",
          content: "Duración del video: " + durationSeconds + " segundos. Contexto de la historia (" + prompt.length + " caracteres). Escribe diálogos breves para esta historia, distribuidos a lo largo de su desarrollo. Historia:\n" + prompt.slice(0, 10000)
        }
      ],
      max_tokens: 1100,
      temperature: 0.65
    });
    let raw = typeof result?.response === "string" ? result.response : "";
    if (!raw && typeof result?.output_text === "string") raw = result.output_text;
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    const parsed = JSON.parse(raw.slice(first, last + 1));
    const source = Array.isArray(parsed?.dialogues) ? parsed.dialogues : [];
    const dialogues = source.slice(0, 18).flatMap((line) => {
      const speaker = typeof line?.speaker === "string" ? line.speaker.trim().slice(0, 50) : "";
      const text = typeof line?.text === "string" ? line.text.trim().slice(0, 180) : "";
      const position = Number(line?.position);
      if (!speaker || text.length < 2 || !prompt.toLowerCase().includes(speaker.toLowerCase())) return [];
      return [{ speaker, text, position: Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : 0.5 }];
    });
    return dialogues.length ? { source: "workers-ai-generated", dialogues } : null;
  } catch (error) {
    console.warn("Optional AI dialogue generation unavailable; explicit screenplay dialogue will be used.", error?.message || error);
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await currentUser(request, env);
    if (auth.error) return auth.error;
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "invalid_json", message: "El cuerpo debe ser JSON válido." }, 400); }

    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const durationSeconds = Number(body?.durationSeconds);
    const segmentSeconds = Number(body?.segmentSeconds || 30);
    const projectId = body?.projectId || null;

    if (prompt.length < 30) return json({ ok: false, error: "invalid_prompt", message: "Se requiere una descripción de al menos 30 caracteres." }, 400);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 1200) {
      return json({ ok: false, error: "invalid_duration", message: "La duración debe estar entre 15 segundos y 20 minutos." }, 400);
    }
    if (![15, 30].includes(segmentSeconds) || durationSeconds % segmentSeconds !== 0) {
      return json({ ok: false, error: "invalid_segment_size", message: "Usa segmentos de 15 o 30 segundos que dividan exactamente la duración." }, 400);
    }
    const inputMode = ["text","images","both"].includes(body?.inputMode) ? body.inputMode : "text";
    if (typeof projectId !== "string" || !projectId) {
      return json({ ok: false, error: "project_required", message: "Selecciona un proyecto de tu biblioteca para asociar la producción y sus imágenes." }, 400);
    }
    const projectCheck = await fetch(
      `${auth.url}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id`,
      { headers: { apikey: auth.key, authorization: `Bearer ${auth.token}` } }
    );
    if (!projectCheck.ok) return json({ ok: false, error: "project_validation_failed", message: "No se pudo validar el proyecto seleccionado." }, 502);
    const ownedProjects = await projectCheck.json().catch(() => []);
    if (!ownedProjects.length) return json({ ok: false, error: "project_not_found", message: "El proyecto no existe o no pertenece a tu cuenta." }, 404);

    let referenceMediaCount = 0;
    {
      const assetCheck = await fetch(
        `${auth.url}/rest/v1/project_assets?project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,mime_type`,
        { headers: { apikey: auth.key, authorization: `Bearer ${auth.token}` } }
      );
      if (!assetCheck.ok) return json({ ok: false, error: "reference_media_check_failed", message: "No se pudieron consultar las referencias visuales del proyecto." }, 502);
      const assets = await assetCheck.json().catch(() => []);
      referenceMediaCount = assets.filter(item => {
        const mime = String(item.mime_type || "").toLowerCase();
        return mime.startsWith("image/") || mime.startsWith("video/");
      }).length;
      if (!referenceMediaCount) return json({ ok: false, error: "reference_media_required", message: "El proyecto no tiene imágenes ni videos de referencia guardados en Supabase. Añade al menos una referencia visual antes de producir." }, 400);
    }

    const audioScript = await createOptionalDialogueScript(prompt, durationSeconds, env);
    const payload = {
      prompt,
      audio_script: audioScript,
      requested_resolution: body?.resolution === "1080p" ? "1080p" : "720p",
      visual_style: typeof body?.style === "string" ? body.style.slice(0, 100) : "Realista cinematográfico",
      voice: typeof body?.voice === "string" ? body.voice.slice(0, 30) : "female",
      input_mode: inputMode,
      reference_image_count: referenceMediaCount,
      reference_media_count: referenceMediaCount,
      continuity_mode: "last_frame_chained",
      production_profile: ["balanced","cinematic","light"].includes(body?.productionProfile) ? body.productionProfile : "balanced"
    };
    const response = await fetch(`${auth.url}/rest/v1/video_jobs`, {
      method: "POST",
      headers: {
        apikey: auth.key,
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
        prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: auth.user.id,
        project_id: projectId,
        prompt,
        duration_seconds: durationSeconds,
        segment_seconds: segmentSeconds,
        total_segments: durationSeconds / segmentSeconds,
        payload
      })
    });
    const result = await response.json().catch(() => []);
    if (!response.ok) return json({ ok: false, error: "job_create_failed", message: "Supabase no pudo registrar el trabajo. Verifica que se haya aplicado la migración video_jobs.", details: result }, response.status);
    return json({
      ok: true,
      status: "queued",
      audio_script_mode: audioScript ? "ai_dialogue_generated" : "explicit_dialogue_or_ambient_only",
      job: Array.isArray(result) ? result[0] : result
    }, 201);
  } catch (error) {
    return json({ ok: false, error: "server_configuration_error", message: error.message }, 500);
  }
}


export async function onRequestDelete({ request, env }) {
  try {
    const auth = await currentUser(request, env);
    if (auth.error) return auth.error;
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: "invalid_json", message: "El cuerpo debe ser JSON válido." }, 400); }
    const id = typeof body?.id === "string" ? body.id : "";
    const action = body?.action === "cancel" ? "cancel" : "delete";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return json({ ok: false, error: "invalid_id", message: "Identificador de trabajo no válido." }, 400);
    }
    const headers = { apikey: auth.key, authorization: `Bearer ${auth.token}` };
    const lookup = await fetch(`${auth.url}/rest/v1/video_jobs?id=eq.${id}&user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,status,output_path`, { headers });
    const rows = await lookup.json().catch(() => []);
    if (!lookup.ok) return json({ ok: false, error: "job_lookup_failed", message: "No se pudo consultar el trabajo." }, lookup.status);
    const job = rows[0];
    if (!job) return json({ ok: false, error: "not_found", message: "No se encontró ese trabajo." }, 404);

    if (action === "cancel") {
      if (["completed","failed","cancelled"].includes(job.status)) {
        return json({ ok: true, status: job.status, message: "El trabajo ya no está en ejecución." });
      }
      const cancelled = await fetch(`${auth.url}/rest/v1/rpc/cancel_video_job`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ p_job_id: id })
      });
      const result = await cancelled.json().catch(() => null);
      if (!cancelled.ok) return json({ ok: false, error: "cancel_failed", message: "No se pudo solicitar la cancelación. Aplica la migración SQL actualizada.", details: result }, cancelled.status);
      const cancelStatus = typeof result === "string" ? result : "cancelling";
      return json({ ok: true, status: cancelStatus, message: cancelStatus === "cancelled" ? "Trabajo cancelado antes de iniciar." : "Detención solicitada. Kaggle interrumpirá Wan 2.2 y confirmará la cancelación." });
    }

    if (["queued","processing","assembling","cancelling"].includes(job.status)) {
      return json({ ok: false, error: "job_active", message: "Primero detén el trabajo y espera a que aparezca como Cancelado." }, 409);
    }
    if (job.output_path) {
      const objectPath = job.output_path.split("/").map(encodeURIComponent).join("/");
      const removed = await fetch(`${auth.url}/storage/v1/object/video-renders/${objectPath}`, {
        method: "DELETE", headers
      });
      if (!removed.ok && removed.status !== 404) {
        const details = await removed.text().catch(() => "");
        return json({ ok: false, error: "render_delete_failed", message: "No se pudo eliminar el MP4 guardado.", details }, removed.status);
      }
    }
    const deleted = await fetch(`${auth.url}/rest/v1/video_jobs?id=eq.${id}&user_id=eq.${encodeURIComponent(auth.user.id)}&status=not.in.(queued,processing,assembling)`, {
      method: "DELETE", headers: { ...headers, Prefer: "return=representation" }
    });
    const removedRows = await deleted.json().catch(() => []);
    if (!deleted.ok) return json({ ok: false, error: "job_delete_failed", message: "No se pudo eliminar el registro. Verifica los permisos SQL.", details: removedRows }, deleted.status);
    if (!Array.isArray(removedRows) || !removedRows.length) return json({ ok: false, error: "job_active", message: "El trabajo cambió de estado. Actualiza la cola e inténtalo de nuevo." }, 409);
    return json({ ok: true, status: "deleted", message: "Trabajo eliminado." });
  } catch (error) {
    return json({ ok: false, error: "server_configuration_error", message: error.message }, 500);
  }
}
