const json = (body, status=200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" }
});

const IMAGE_MODEL="@cf/black-forest-labs/flux-2-klein-4b";
const SPEECH_MODEL="@cf/deepgram/aura-2-es";
const MAX_PROMPT=3000;
const MAX_SPEECH_TEXT=1200;
const SPEAKERS=new Set(["sirio","nestor","carina","celeste","alvaro","diana","aquila","selena","estrella","javier"]);
const MAX_SPEECH_BATCH_CHARS=3500;

async function speechOutputBytes(output) {
  let audio=typeof ReadableStream!=="undefined"&&output instanceof ReadableStream
    ?output:(output?.audio??output?.data??output);
  if(typeof Response!=="undefined"&&audio instanceof Response)
    return new Uint8Array(await audio.arrayBuffer());
  if(typeof ReadableStream!=="undefined"&&audio instanceof ReadableStream)
    return new Uint8Array(await new Response(audio).arrayBuffer());
  if(audio instanceof ArrayBuffer)return new Uint8Array(audio);
  if(ArrayBuffer.isView(audio))return new Uint8Array(audio.buffer,audio.byteOffset,audio.byteLength);
  if(typeof audio==="string"){
    const encoded=audio.replace(/^data:audio[^;]*;base64,/i,"");
    const binary=atob(encoded),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array();
}

function encodeBase64(bytes) {
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=0x8000)
    binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));
  return btoa(binary);
}

export async function onRequestGet({request,env}) {
  const token=(request.headers.get("authorization")||"").startsWith("Bearer ");
  if(token) {
    try { return await listVideoJobs(request,env); }
    catch(error) { return json({ok:false,error:"jobs_query_failed",message:error.message},500); }
  }
  return json({
    ok:true,
    policy:{billing:"free-allocation-only-no-provider-fallback",paidFallback:false,model:IMAGE_MODEL,speechModel:SPEECH_MODEL,speechLanguage:"Spanish",dailyAppCaps:{images:30,speech:1},speechBatchMaxCharacters:MAX_SPEECH_BATCH_CHARS,speechBatchMaxLines:40,speechBatchRequestsDaily:1,accountPlanRequirement:"Workers Free is required for a guaranteed hard stop at the free allocation; Workers Paid can bill overage."},
    diagnostics:{AI:Boolean(env.AI),SUPABASE_URL:Boolean(env.SUPABASE_URL),SUPABASE_ANON_KEY:Boolean(env.SUPABASE_ANON_KEY)}
  });
}

function strengthenPrompt(value) {
  const prompt=value.trim();
  const asksCar=/\b(auto|autom[oó]vil|coche|carro|veh[ií]culo|sports car|race car)\b/i.test(prompt);
  const asksMotorcycle=/\b(moto|motocicleta|motorcycle|motorbike)\b/i.test(prompt);
  const guard=asksCar&&!asksMotorcycle
    ?" REQUIRED SUBJECT: a clearly visible FOUR-WHEELED AUTOMOBILE. Do not substitute a motorcycle, bicycle, scooter, or any two-wheeled vehicle."
    :asksMotorcycle
      ?" REQUIRED SUBJECT: a motorcycle, because the prompt explicitly requests one."
      :"Follow the requested subject and objects literally; do not invent or substitute the main subject.";
  const suffix="\n\nCinematic still frame, realistic materials and anatomy, coherent lighting, detailed environment, 16:9 composition. "+guard+" No collage, no split panels, no captions, no watermark.";
  // FLUX.1 schnell rejects prompts longer than 2,048 characters.
  // Reserve room for the continuity/subject instructions before calling Workers AI.
  return prompt.slice(0,Math.max(0,2048-suffix.length))+suffix;
}

function quotaError(error) {
  const message=String(error?.message||error||"");
  return /quota|limit|neuron|daily|exceed|capacity|rate.?limit/i.test(message);
}

async function queueAuth(request, env) {
  const auth=request.headers.get("authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token) return {error:json({ok:false,error:"unauthorized",message:"Inicia sesión para consultar tus trabajos."},401)};
  if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY) return {error:json({ok:false,error:"supabase_server_config_missing",message:"Falta la configuración de Supabase en Cloudflare."},503)};
  const base=env.SUPABASE_URL.replace(/\/$/,"");
  const verified=await fetch(base+"/auth/v1/user",{headers:{apikey:env.SUPABASE_ANON_KEY,authorization:"Bearer "+token}});
  if(!verified.ok) return {error:json({ok:false,error:"invalid_session",message:"Tu sesión no es válida. Vuelve a iniciar sesión."},401)};
  return {base,token,user:await verified.json(),key:env.SUPABASE_ANON_KEY};
}
async function reserveFreeAiQuota(auth,kind) {
  const response=await fetch(auth.base+"/rest/v1/rpc/reserve_vsa_ai_quota",{
    method:"POST",
    headers:{apikey:auth.key,authorization:"Bearer "+auth.token,"content-type":"application/json"},
    body:JSON.stringify({p_kind:kind})
  });
  const result=await response.json().catch(()=>0);
  if(!response.ok)throw new Error("No se pudo comprobar el cupo gratuito de IA. Aplica la migración 202611230003_free_ai_quota.sql. "+JSON.stringify(result).slice(0,300));
  return Number(result)||0;
}

async function createOptionalDialogueScript(prompt,durationSeconds,env) {
  if(env.VSA_ENABLE_AI_DIALOGUE!=="true"||!env.AI?.run) return null;
  try {
    const result=await env.AI.run("@cf/meta/llama-3.2-1b-instruct",{
      messages:[
        {role:"system",content:"Eres guionista de doblaje en español latino mexicano. Devuelve exclusivamente JSON válido {\"dialogues\":[{\"speaker\":\"nombre exacto\",\"text\":\"frase\",\"position\":0.0}]}. Usa solo personajes nombrados en la historia, no inventes hechos. Máximo 18 frases de 180 caracteres. position entre 0 y 1."},
        {role:"user",content:"Duración: "+durationSeconds+" segundos. Historia:\n"+prompt.slice(0,10000)}
      ],max_tokens:1100,temperature:0.65
    });
    const raw=typeof result?.response==="string"?result.response:typeof result?.output_text==="string"?result.output_text:"";
    const first=raw.indexOf("{"),last=raw.lastIndexOf("}");
    if(first<0||last<=first)return null;
    const parsed=JSON.parse(raw.slice(first,last+1));
    const dialogues=(Array.isArray(parsed?.dialogues)?parsed.dialogues:[]).slice(0,18).flatMap(line=>{
      const speaker=typeof line?.speaker==="string"?line.speaker.trim().slice(0,50):"";
      const text=typeof line?.text==="string"?line.text.trim().slice(0,180):"";
      const position=Number(line?.position);
      if(!speaker||text.length<2||!prompt.toLowerCase().includes(speaker.toLowerCase()))return [];
      return [{speaker,text,position:Number.isFinite(position)?Math.max(0,Math.min(1,position)):0.5}];
    });
    return dialogues.length?{source:"workers-ai-generated",dialogues}:null;
  } catch(error) {
    console.warn("Optional AI dialogue generation unavailable.",error?.message||error);
    return null;
  }
}
async function listVideoJobs(request,env) {
  const auth=await queueAuth(request,env);
  if(auth.error)return auth.error;
  const response=await fetch(auth.base+"/rest/v1/video_jobs?select=id,project_id,duration_seconds,segment_seconds,total_segments,status,progress,completed_segments,output_path,error_message,created_at,updated_at&user_id=eq."+encodeURIComponent(auth.user.id)+"&order=created_at.desc&limit=1000",{
    headers:{apikey:auth.key,authorization:"Bearer "+auth.token}
  });
  const rows=await response.json().catch(()=>[]);
  if(!response.ok){const db=Array.isArray(rows)?rows[0]:rows;const code=db?.code||"sin código";const detail=[db?.message,db?.details,db?.hint].filter(Boolean).join(" · ");return json({ok:false,error:"jobs_query_failed",message:"No se pudieron consultar los trabajos de video (Supabase "+code+"). "+(detail||"Comprueba que exista la tabla public.video_jobs y que la migración esté aplicada."),details:rows},response.status);}
  for(const job of rows){
    if(job.status==="completed"&&job.output_path){
      const signed=await fetch(auth.base+"/storage/v1/object/sign/video-renders/"+job.output_path.split("/").map(encodeURIComponent).join("/"),{
        method:"POST",headers:{apikey:auth.key,authorization:"Bearer "+auth.token,"content-type":"application/json"},body:JSON.stringify({expiresIn:3600})
      });
      if(signed.ok){const data=await signed.json();job.download_url=data.signedURL?.startsWith("http")?data.signedURL:auth.base+"/storage/v1"+data.signedURL;}
    }
  }
  return json({ok:true,ready:true,status:"queue_connected",label:"Cola de trabajos conectada",jobs:rows});
}
async function createVideoJob(request,env,body,auth) {
  const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
  const durationSeconds=Number(body.durationSeconds);
  const segmentSeconds=Number(body.segmentSeconds||30);
  const projectId=typeof body.projectId==="string"?body.projectId:null;
  if(prompt.length<30)return json({ok:false,error:"invalid_prompt",message:"La historia debe contener al menos 30 caracteres."},400);
  if(!Number.isInteger(durationSeconds)||durationSeconds<15||durationSeconds>1200)return json({ok:false,error:"invalid_duration",message:"La duración debe estar entre 15 segundos y 20 minutos."},400);
  if(![15,30].includes(segmentSeconds)||durationSeconds%segmentSeconds!==0)return json({ok:false,error:"invalid_segment_size",message:"Elige segmentos de 15 o 30 segundos que dividan exactamente la duración."},400);
  if(!projectId)return json({ok:false,error:"project_required",message:"Selecciona el proyecto donde guardar el video."},400);
  const ownerCheck=await fetch(auth.base+"/rest/v1/projects?select=id&id=eq."+encodeURIComponent(projectId)+"&user_id=eq."+encodeURIComponent(auth.user.id),{
    headers:{apikey:auth.key,authorization:"Bearer "+auth.token}
  });
  const owned=await ownerCheck.json().catch(()=>[]);
  if(!ownerCheck.ok||!Array.isArray(owned)||!owned.length)return json({ok:false,error:"project_not_owned",message:"El proyecto seleccionado no existe o no pertenece a tu cuenta."},403);

  // The GPU worker must receive the exact production plan created in the film studio.
  const manifestUrl=auth.base+"/rest/v1/production_manifests?select=id,manifest&project_id=eq."+encodeURIComponent(projectId)
    +"&user_id=eq."+encodeURIComponent(auth.user.id)+"&order=updated_at.desc&limit=1";
  const manifestResponse=await fetch(manifestUrl,{headers:{apikey:auth.key,authorization:"Bearer "+auth.token}});
  const manifestRows=await manifestResponse.json().catch(()=>[]);
  if(!manifestResponse.ok)return json({ok:false,error:"production_manifest_lookup_failed",message:"No se pudo recuperar el plan cinematográfico del proyecto."},manifestResponse.status);
  const productionManifest=Array.isArray(manifestRows)&&manifestRows.length?manifestRows[0].manifest:null;
  const manifestSegments=Array.isArray(productionManifest?.segments)?productionManifest.segments:[];
  if(!productionManifest||Number(productionManifest.targetSeconds)!==durationSeconds
      ||Number(productionManifest.maxSegmentSeconds)!==segmentSeconds
      ||manifestSegments.length!==durationSeconds/segmentSeconds){
    return json({ok:false,error:"production_plan_mismatch",message:"Prepara o actualiza el plan en Estudio de producción cinematográfica con la misma duración y segmentos antes de enviar a Kaggle."},409);
  }
  const missingMasters=manifestSegments.filter(segment=>!segment.assets?.image?.storagePath);
  if(missingMasters.length){
    return json({ok:false,error:"segment_master_images_missing",message:"Faltan imágenes maestras en "+missingMasters.length+" segmento(s). Genera y guarda la imagen de cada segmento en Estudio de producción antes de iniciar Wan 2.2.",details:{missing:missingMasters.map(segment=>segment.id)}},409);
  }
  const masterPaths=manifestSegments.map(segment=>String(segment.assets.image.storagePath));
  const masterAssetCheck=await fetch(auth.base+"/rest/v1/project_assets?select=storage_path&project_id=eq."+encodeURIComponent(projectId)
    +"&user_id=eq."+encodeURIComponent(auth.user.id),{headers:{apikey:auth.key,authorization:"Bearer "+auth.token}});
  const masterAssetRows=await masterAssetCheck.json().catch(()=>[]);
  const ownedMasterPaths=new Set((Array.isArray(masterAssetRows)?masterAssetRows:[]).map(asset=>String(asset.storage_path||"")));
  if(!masterAssetCheck.ok||masterPaths.some(path=>!ownedMasterPaths.has(path)))
    return json({ok:false,error:"segment_master_not_owned",message:"Una o más imágenes maestras no están guardadas como recursos del proyecto seleccionado."},403);
  // Dialogue timing is derived from the saved screenplay manifest, not guessed from names.
  const plannedDialogues=manifestSegments.flatMap(segment=>(segment.dialogues||[]).map(line=>({
    speaker:String(line.character||"").trim(),
    text:String(line.text||"").trim(),
    voice:String(segment.voiceAssignments?.[line.character]||""),
    time_seconds:Number(segment.startSeconds||0)+Math.max(0,Number(line.atSeconds)||0)
  }))).filter(line=>line.speaker&&line.text.length>1);
  const effectMap={
    motor_automovil:"engine",motor_motocicleta:"engine",pasos:"footsteps",herramientas_taller:"tools",
    puerta:"door",impacto:"impact",tazas_vasos:"cups",risas:"laughter",conversaciones_fondo:"crowd",
    aves:"birds",animales:"animal",perros:"dog",gatos:"cat",caballos:"horse",cocina:"cooking",
    caja_registradora:"cash_register",carritos_compras:"shopping_cart",equipo_medico:"medical_beep",
    alarma:"alarm",tren_metro:"train",aeropuerto:"aircraft",agua:"water",fuego:"fire",insectos:"insects",
    paginas:"pages",timbre_escolar:"school_bell",elevador:"elevator",autobus:"bus",
    construccion:"construction",gimnasio:"gym",campanas_iglesia:"church_bell"
  };
  const plannedEffects=manifestSegments.flatMap(segment=>(segment.audioCues||[])
    .map(cue=>effectMap[cue]).filter(Boolean).map(name=>({
      name,time_seconds:Number(segment.startSeconds||0)+0.25,
      duration_seconds:Math.min(2,Number(segment.durationSeconds)||2)
    })));
  const audioScript=(plannedDialogues.length||plannedEffects.length)
    ? {source:"production_manifest",dialogues:plannedDialogues,effects:plannedEffects}
    : await createOptionalDialogueScript(prompt,durationSeconds,env);
  const payload={
    prompt,audio_script:audioScript,production_manifest:productionManifest,
    requested_resolution:body.resolution==="1080p"?"1080p":"720p",
    visual_style:typeof body.style==="string"?body.style.slice(0,100):"Realista cinematográfico",
    voice:typeof body.voice==="string"?body.voice.slice(0,30):"female",
    input_mode:typeof body.inputMode==="string"?body.inputMode.slice(0,30):"text"
  };
  const response=await fetch(auth.base+"/rest/v1/video_jobs",{
    method:"POST",headers:{apikey:auth.key,authorization:"Bearer "+auth.token,"content-type":"application/json",prefer:"return=representation"},
    body:JSON.stringify({user_id:auth.user.id,project_id:projectId,prompt,duration_seconds:durationSeconds,segment_seconds:segmentSeconds,total_segments:durationSeconds/segmentSeconds,payload})
  });
  const result=await response.json().catch(()=>[]);
  if(!response.ok){const db=Array.isArray(result)?result[0]:result;const code=db?.code||"sin código";const detail=[db?.message,db?.details,db?.hint].filter(Boolean).join(" · ");return json({ok:false,error:"job_create_failed",message:"Supabase rechazó el registro del trabajo (código "+code+"). "+(detail||"Comprueba que public.video_jobs exista y tenga las columnas requeridas. Aplica la migración supabase/migrations/202611190001_video_jobs.sql."),details:result},response.status);}
  return json({ok:true,status:"queued",audio_script_mode:audioScript?"ai_dialogue_generated":"explicit_dialogue_or_ambient_only",job:Array.isArray(result)?result[0]:result},201);
}

async function removeStoredRender(auth,outputPath) {
  if(!outputPath)return;
  const encoded=outputPath.split("/").map(encodeURIComponent).join("/");
  const response=await fetch(auth.base+"/storage/v1/object/video-renders/"+encoded,{
    method:"DELETE",
    headers:{apikey:auth.key,authorization:"Bearer "+auth.token}
  });
  if(!response.ok&&response.status!==404){
    const detail=await response.text().catch(()=>"");
    throw new Error("No se pudo eliminar el MP4 almacenado ("+response.status+"). "+detail.slice(0,300));
  }
}

export async function onRequestDelete({request,env}) {
  try {
    const auth=await queueAuth(request,env);
    if(auth.error)return auth.error;
    const body=await request.json().catch(()=>null);
    const id=typeof body?.id==="string"?body.id.trim():"";
    const action=body?.action==="cancel"?"cancel":"delete";
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      return json({ok:false,error:"invalid_job_id",message:"El identificador del trabajo no es válido."},400);

    const headers={apikey:auth.key,authorization:"Bearer "+auth.token};
    const lookup=await fetch(auth.base+"/rest/v1/video_jobs?select=id,status,output_path&id=eq."+encodeURIComponent(id)+"&user_id=eq."+encodeURIComponent(auth.user.id),{headers});
    const rows=await lookup.json().catch(()=>[]);
    if(!lookup.ok)return json({ok:false,error:"job_lookup_failed",message:"No se pudo consultar el trabajo antes de continuar."},lookup.status);
    if(!Array.isArray(rows)||!rows.length)return json({ok:false,error:"job_not_found",message:"El trabajo no existe o no pertenece a tu cuenta."},404);
    const job=rows[0];

    if(action==="cancel"){
      if(["completed","failed","cancelled"].includes(job.status))
        return json({ok:true,status:job.status,message:"El trabajo ya no está en ejecución."});
      const cancelled=await fetch(auth.base+"/rest/v1/rpc/cancel_video_job",{
        method:"POST",
        headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({p_job_id:id})
      });
      const result=await cancelled.json().catch(()=>null);
      if(!cancelled.ok)return json({ok:false,error:"cancel_failed",message:"Supabase no pudo solicitar la cancelación. Comprueba que la migración de cola esté aplicada.",details:result},cancelled.status);
      const cancelStatus=typeof result==="string"?result:(result?.status||"cancelling");
      return json({
        ok:true,status:cancelStatus,
        message:cancelStatus==="cancelled"?"Trabajo cancelado antes de iniciar.":"Detención solicitada. Kaggle confirmará la cancelación al interrumpir Wan 2.2."
      });
    }

    if(["queued","processing","assembling","cancelling"].includes(job.status))
      return json({ok:false,error:"job_is_active",message:"Primero cancela o detén el trabajo y espera a que aparezca como Cancelado."},409);

    await removeStoredRender(auth,job.output_path);
    const deletion=await fetch(auth.base+"/rest/v1/video_jobs?id=eq."+encodeURIComponent(id)+"&user_id=eq."+encodeURIComponent(auth.user.id)+"&status=not.in.(queued,processing,assembling,cancelling)",{
      method:"DELETE",
      headers:{...headers,prefer:"return=representation"}
    });
    const deleted=await deletion.json().catch(()=>[]);
    if(!deletion.ok)return json({ok:false,error:"job_delete_failed",message:"Supabase no pudo eliminar el trabajo. Comprueba los permisos de borrado de la migración.",details:deleted},deletion.status);
    if(!Array.isArray(deleted)||!deleted.length)
      return json({ok:false,error:"job_state_changed",message:"El trabajo cambió de estado y no se eliminó. Actualiza la lista e inténtalo cuando no esté en proceso."},409);
    return json({ok:true,deleted:true,id});
  } catch(error) {
    return json({ok:false,error:"job_delete_failed",message:String(error?.message||error)},500);
  }
}

export async function onRequestPost({request,env}) {
  try {
    if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)
      return json({ok:false,error:"supabase_server_config_missing",message:"Falta la configuración de Supabase en Cloudflare."},503);

    const auth=request.headers.get("authorization")||"";
    const token=auth.startsWith("Bearer ")?auth.slice(7):"";
    if(!token) return json({ok:false,error:"unauthorized",message:"Inicia sesión para generar imágenes."},401);

    const base=env.SUPABASE_URL.replace(/\/$/,"");
    const verified=await fetch(base+"/auth/v1/user",{
      headers:{apikey:env.SUPABASE_ANON_KEY,authorization:"Bearer "+token}
    });
    if(!verified.ok) return json({ok:false,error:"invalid_session",message:"Tu sesión no es válida. Vuelve a iniciar sesión."},401);

    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=="object")
      return json({ok:false,error:"invalid_json",message:"El cuerpo debe ser JSON válido."},400);
    if(typeof body.action!=="string") {
      const queueAuthResult=await queueAuth(request,env);
      if(queueAuthResult.error)return queueAuthResult.error;
      return await createVideoJob(request,env,body,queueAuthResult);
    }

    if(body.action==="generate_speech_batch"){
      if(!env.AI) return json({ok:false,error:"ai_binding_missing",message:"Falta el binding Workers AI llamado AI. No se activará ningún proveedor de pago."},503);
      const speechAuth=await queueAuth(request,env);
      if(speechAuth.error)return speechAuth.error;
      const rows=Array.isArray(body.dialogues)?body.dialogues:[];
      if(!rows.length||rows.length>40)
        return json({ok:false,error:"invalid_speech_batch",message:"El lote debe contener entre 1 y 40 intervenciones."},400);
      const dialogues=rows.map((row,index)=>({
        index:Number.isInteger(Number(row?.index))?Number(row.index):index,
        segmentId:String(row?.segmentId??"").slice(0,80),
        text:typeof row?.text==="string"?row.text.trim():"",
        speaker:typeof row?.speaker==="string"?row.speaker.toLowerCase():"alvaro"
      }));
      const totalCharacters=dialogues.reduce((sum,row)=>sum+row.text.length,0);
      if(dialogues.some(row=>!row.text||row.text.length>MAX_SPEECH_TEXT||!SPEAKERS.has(row.speaker)))
        return json({ok:false,error:"invalid_speech_batch_item",message:"Cada intervención debe tener texto de hasta 1,200 caracteres y una voz española disponible."},400);
      if(totalCharacters>MAX_SPEECH_BATCH_CHARS)
        return json({ok:false,error:"speech_batch_too_large",message:"Para mantener la voz dentro de la asignación gratuita diaria, el lote no puede superar 3,500 caracteres. Divide la película en partes."},413);
      const speechQuota=await reserveFreeAiQuota(speechAuth,"speech");
      if(!speechQuota)return json({ok:false,error:"free_quota_exhausted",message:"Se alcanzó el límite interno gratuito diario de voz. El lote se detuvo sin recurrir a servicios de pago."},429);
      const audio=[];
      for(const item of dialogues){
        const output=await env.AI.run(SPEECH_MODEL,{text:item.text,speaker:item.speaker,encoding:"mp3"});
        const bytes=await speechOutputBytes(output);
        if(!bytes.length)
          return json({ok:false,error:"empty_speech_response",message:"El motor de voz devolvió audio vacío en la intervención "+(item.index+1)+". No se intentó usar un proveedor de pago."},502);
        audio.push({segmentId:item.segmentId,index:item.index,audio:encodeBase64(bytes)});
      }
      return json({ok:true,audio,characters:totalCharacters,requestCount:audio.length,billing:"workers-ai-free-allocation-only"});
    }

    if(body.action==="generate_speech"){
      if(!env.AI) return json({ok:false,error:"ai_binding_missing",message:"Falta el binding Workers AI llamado AI. No se activará ningún proveedor de pago."},503);
      const speechAuth=await queueAuth(request,env);
      if(speechAuth.error)return speechAuth.error;
      const text=typeof body.text==="string"?body.text.trim():"";
      const speaker=typeof body.speaker==="string"?body.speaker.toLowerCase():"alvaro";
      if(!text||text.length>MAX_SPEECH_TEXT)
        return json({ok:false,error:"invalid_speech_text",message:"Cada diálogo debe contener entre 1 y 1,200 caracteres."},400);
      if(!SPEAKERS.has(speaker))
        return json({ok:false,error:"invalid_speaker",message:"La voz seleccionada no está disponible."},400);
      const speechQuota=await reserveFreeAiQuota(speechAuth,"speech");
      if(!speechQuota)return json({ok:false,error:"free_quota_exhausted",message:"Se alcanzó el límite interno gratuito de 1 generación de voz por día. Se detuvo sin recurrir a servicios de pago."},429);
      // Spanish Aura-2 TTS uses the same Workers AI free daily neuron allocation.
      // No paid-provider fallback is configured or attempted.
      const output=await env.AI.run(SPEECH_MODEL,{text,speaker,encoding:"mp3"});
      const audio=output instanceof ReadableStream?output:(output?.audio??output?.data??output);
      const headers={
        "content-type":"audio/mpeg",
        "cache-control":"no-store",
        "x-vsa-model":SPEECH_MODEL,
        "x-vsa-billing":"workers-ai-free-allocation-only"
      };
      if(audio instanceof ReadableStream||audio instanceof ArrayBuffer||ArrayBuffer.isView(audio))
        return new Response(audio,{status:200,headers});
      if(typeof audio==="string"){
        const encoded=audio.replace(/^data:audio[^;]*;base64,/i,"");
        const bytes=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));
        return new Response(bytes,{status:200,headers});
      }
      return json({ok:false,error:"empty_speech_response",message:"El motor de voz no devolvió audio. No se intentó usar un proveedor de pago."},502);
    }

    if(body.action!=="generate_image")
      return json({ok:false,error:"invalid_action",message:"La acción solicitada no está disponible."},400);
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(prompt.length<8||prompt.length>MAX_PROMPT)
      return json({ok:false,error:"invalid_prompt",message:"El prompt debe tener entre 8 y 3,000 caracteres."},400);

    const imageAuth=await queueAuth(request,env);
    if(imageAuth.error)return imageAuth.error;
    const projectId=typeof body.projectId==="string"?body.projectId:"";
    if(!projectId)return json({ok:false,error:"project_required",message:"La generación de fotogramas debe estar vinculada a un proyecto."},400);
    const projectCheck=await fetch(imageAuth.base+"/rest/v1/projects?select=id&id=eq."+encodeURIComponent(projectId)+"&user_id=eq."+encodeURIComponent(imageAuth.user.id),{
      headers:{apikey:imageAuth.key,authorization:"Bearer "+imageAuth.token}
    });
    const ownedProjects=await projectCheck.json().catch(()=>[]);
    if(!projectCheck.ok||!Array.isArray(ownedProjects)||!ownedProjects.length)
      return json({ok:false,error:"project_not_owned",message:"El proyecto de referencia no pertenece a tu cuenta."},403);
    if(!env.AI) return json({ok:false,error:"ai_binding_missing",message:"Falta el binding Workers AI llamado AI. No se activará ningún proveedor de pago."},503);
    const referenceImages=Array.isArray(body.referenceImages)?body.referenceImages.slice(0,4):[];
    const referenceAssetIds=Array.isArray(body.referenceAssetIds)?body.referenceAssetIds.slice(0,4).map(String):[];
    if(Array.isArray(body.referenceImages)&&body.referenceImages.length>4)
      return json({ok:false,error:"too_many_references",message:"Se admiten hasta cuatro referencias visuales por fotograma."},400);
    if(referenceImages.length!==referenceAssetIds.length)
      return json({ok:false,error:"invalid_reference_pair",message:"Cada referencia visual debe incluir su archivo y el identificador del recurso guardado."},400);
    if(referenceAssetIds.length){
      const assetCheck=await fetch(imageAuth.base+"/rest/v1/project_assets?select=id,mime_type&project_id=eq."+encodeURIComponent(projectId)+"&user_id=eq."+encodeURIComponent(imageAuth.user.id),{
        headers:{apikey:imageAuth.key,authorization:"Bearer "+imageAuth.token}
      });
      const projectAssets=await assetCheck.json().catch(()=>[]);
      const ownedVisualAssets=new Map((Array.isArray(projectAssets)?projectAssets:[])
        .filter(asset=>String(asset.mime_type||"").startsWith("image/")||String(asset.mime_type||"").startsWith("video/"))
        .map(asset=>[String(asset.id),asset]));
      if(!assetCheck.ok||referenceAssetIds.some(id=>!ownedVisualAssets.has(id)))
        return json({ok:false,error:"reference_asset_not_owned",message:"Una referencia no pertenece a los recursos visuales guardados en este proyecto."},403);
    }
    const imageQuota=await reserveFreeAiQuota(imageAuth,"image");
    if(!imageQuota)return json({ok:false,error:"free_quota_exhausted",message:"Se alcanzó el límite interno gratuito de 30 imágenes por día. Los fotogramas ya guardados se conservan y podrás continuar después del reinicio del cupo. No se intentó usar un servicio de pago."},429);
    // Text-to-image works without an uploaded reference. Image-to-image uses only
    // references verified as assets owned by this user and project.
    let result;
    if(referenceImages.length){
      const form=new FormData();
      form.set("prompt",strengthenPrompt(prompt));
      form.set("width","1024");
      form.set("height","576");
      for(let index=0;index<referenceImages.length;index++){
        const encoded=String(referenceImages[index]||"").replace(/^data:image\/[^;]+;base64,/i,"");
        if(!encoded||encoded.length>900000||!/^[A-Za-z0-9+/=]+$/.test(encoded))
          return json({ok:false,error:"invalid_reference_image",message:"Una referencia visual está vacía o supera el tamaño permitido."},400);
        const binary=atob(encoded);
        const bytes=new Uint8Array(binary.length);
        for(let offset=0;offset<binary.length;offset++)bytes[offset]=binary.charCodeAt(offset);
        form.set("input_image_"+index,new Blob([bytes],{type:"image/jpeg"}),"reference_"+index+".jpg");
      }
      const multipartRequest=new Request("https://video-studio-ai.invalid/flux-reference-generation",{method:"POST",body:form});
      const multipartType=multipartRequest.headers.get("content-type");
      result=await env.AI.run(IMAGE_MODEL,{multipart:{body:multipartRequest.body,contentType:multipartType}});
    }else{
      // FLUX.2 Klein 4B accepts multipart input only, including text-to-image.
      // Sending a plain JSON object here is rejected by Workers AI and leaves
      // the image button apparently doing nothing.
      const form=new FormData();
      form.set("prompt",strengthenPrompt(prompt));
      form.set("width","1024");
      form.set("height","576");
      const multipartRequest=new Request("https://video-studio-ai.invalid/flux-text-generation",{
        method:"POST",
        body:form
      });
      result=await env.AI.run(IMAGE_MODEL,{
        multipart:{
          body:multipartRequest.body,
          contentType:multipartRequest.headers.get("content-type")
        }
      });
    }
    if(!result||typeof result.image!=="string"||!result.image.length)
      return json({ok:false,error:"empty_model_response",message:"El modelo no devolvió una imagen. No se realizó ningún cargo alternativo."},502);

    return json({ok:true,image:result.image,model:IMAGE_MODEL,billing:"workers-ai-free-allocation-with-daily-app-cap",reference_count:referenceImages.length});
  } catch(error) {
    const detail=String(error?.message||error||"Error desconocido").replace(/[\\r\\n]+/g," ").slice(0,900);
    const upstreamStatus=Number(error?.status||error?.statusCode||0)||null;
    console.error("VIDEO STUDIO AI Workers AI generation failed:",{status:upstreamStatus,message:detail});
    if(quotaError(error)||upstreamStatus===429||/5028|quota|daily limit|neurons exhausted/i.test(detail))
      return json({
        ok:false,error:"free_quota_exhausted",
        message:"Se alcanzó el límite gratuito disponible de Workers AI. La generación quedó detenida; no se intentó usar un servicio de pago. Detalle: "+detail
      },429);
    return json({
      ok:false,error:"generation_failed",
      message:"Workers AI no pudo generar el fotograma. No se activó ningún proveedor de pago. Detalle técnico: "+detail,
      details:{upstreamStatus}
    },502);
  }
}