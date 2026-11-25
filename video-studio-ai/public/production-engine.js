(() => {
  "use strict";
  const DB_NAME="vsa-production";
  const STORE="manifests";
  const STATUSES=new Set(["planned","assets_ready","rendering","rendered","approved","failed"]);
  const TRANSITIONS={
    planned:["assets_ready","rendering","failed"],
    assets_ready:["rendering","failed"],
    rendering:["rendered","failed"],
    rendered:["approved","rendering","failed"],
    approved:["rendering"],
    failed:["planned","assets_ready","rendering"]
  };
  const VOICES=["claude","ald"];

  function createManifest(analysis,options={}) {
    if(!window.VSASceneEngine) throw new Error("El analizador de escenas no está disponible.");
    const duration=Math.max(1,Math.min(7200,Number(options.durationSeconds)||1200));
    const requestedSegment=Number(options.maxSegmentSeconds)||15;
    const maxSegment=requestedSegment===30?30:15;
    if(duration<15||duration>1200||duration%maxSegment!==0) throw new Error("La película debe durar entre 15 segundos y 20 minutos y ser múltiplo exacto del segmento seleccionado.");
    const plan=window.VSASceneEngine.buildProductionPlan(analysis,duration,maxSegment);
    const characterNames=[...new Set([...(Array.isArray(options.characters)?options.characters:[]),...plan.segments.flatMap(segment=>segment.dialogues.map(line=>line.character))].map(name=>String(name||"").trim()).filter(Boolean))];
    const voiceAssignments={};
    characterNames.forEach((name,index)=>voiceAssignments[name]=VOICES[index%VOICES.length]);
    const segments=plan.segments.map((segment,index)=>({
      ...segment,
      id:"seg-"+String(index+1).padStart(4,"0"),
      order:index+1,
      status:"planned",
      assets:{image:null,video:null,audio:[]},
      references:{characters:[],environment:null,props:[],previousSegmentId:index? "seg-"+String(index).padStart(4,"0"):null},
      continuity:{sameSceneAsPrevious:index>0&&plan.segments[index-1].sceneIndex===segment.sceneIndex,
        inheritCharacterReferences:true,inheritEnvironmentReference:true},
      voiceAssignments:{...voiceAssignments},
      error:null,
      updatedAt:new Date().toISOString()
    }));
    return {
      schemaVersion:2,
      id:"production-"+Date.now().toString(36),
      projectId:options.projectId||null,
      title:options.title||"Producción sin título",
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      targetSeconds:plan.targetSeconds,
      maxSegmentSeconds:plan.maxSegmentSeconds,
      segmentDurationSeconds:plan.maxSegmentSeconds,
      totalSegments:segments.length,
      characters:characterNames.map(name=>({id:slug(name),name,voice:voiceAssignments[name],description:""})),
      segments
    };
  }

  function slug(value){return String(value||"personaje").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"personaje";}
  function findSegment(manifest,id){const segment=manifest?.segments?.find(item=>item.id===id);if(!segment)throw new Error("No se encontró el segmento "+id+".");return segment;}
  function assignAsset(manifest,segmentId,role,asset){
    const segment=findSegment(manifest,segmentId);
    if(!asset||!asset.id)throw new Error("El recurso debe incluir un identificador.");
    if(role==="image"||role==="video")segment.assets[role]={id:String(asset.id),url:asset.url||null,storagePath:asset.storagePath||null,name:asset.name||"",type:asset.type||null};
    else if(role==="environment")segment.references.environment={id:String(asset.id),url:asset.url||null,storagePath:asset.storagePath||null,name:asset.name||""};
    else if(role==="character") {
      const name=String(asset.character||"").trim();
      if(!name)throw new Error("Indica a qué personaje pertenece la referencia.");
      const current=segment.references.characters.filter(item=>item.character!==name);
      current.push({character:name,id:String(asset.id),url:asset.url||null,storagePath:asset.storagePath||null,name:asset.name||""});
      segment.references.characters=current;
    } else if(role==="prop")segment.references.props.push({id:String(asset.id),url:asset.url||null,storagePath:asset.storagePath||null,name:asset.name||""});
    else if(role==="audio")segment.assets.audio.push({id:String(asset.id),url:asset.url||null,storagePath:asset.storagePath||null,name:asset.name||""});
    else throw new Error("Tipo de recurso no reconocido.");
    segment.updatedAt=new Date().toISOString();
    return segment;
  }
  function addCharacter(manifest,name,description=""){
    const clean=String(name||"").trim();
    if(!clean)throw new Error("Escribe el nombre del personaje.");
    if(manifest.characters.some(item=>item.name.toLowerCase()===clean.toLowerCase()))throw new Error("Ese personaje ya está registrado.");
    const profile={id:slug(clean),name:clean,voice:VOICES[manifest.characters.length%VOICES.length],description:String(description||"").trim().slice(0,1200)};
    manifest.characters.push(profile);
    manifest.segments.forEach(segment=>{segment.voiceAssignments[clean]=profile.voice;});
    manifest.updatedAt=new Date().toISOString();
    return profile;
  }
  function updateCharacterProfile(manifest,character,description){
    const profile=manifest.characters.find(item=>item.name===character);
    if(!profile)throw new Error("No se encontró el personaje "+character+".");
    profile.description=String(description||"").trim().slice(0,1200);
    manifest.updatedAt=new Date().toISOString();
    return profile;
  }
  function assignVoice(manifest,character,voice){
    if(!VOICES.includes(voice))throw new Error("La voz seleccionada no está permitida.");
    const profile=manifest.characters.find(item=>item.name===character);
    if(!profile)throw new Error("No se encontró el personaje "+character+".");
    profile.voice=voice;
    manifest.segments.forEach(segment=>{
      if(segment.dialogues.some(line=>line.character===character))segment.voiceAssignments[character]=voice;
    });
    manifest.updatedAt=new Date().toISOString();
    return profile;
  }
  function resolveContinuity(manifest){
    const priorCharacters=new Map();let priorEnvironment=null,priorScene=null;
    manifest.segments.forEach(segment=>{
      if(priorScene!==null&&priorScene!==segment.sceneIndex){
        priorCharacters.clear();
        priorEnvironment=null;
      }
      if(segment.continuity.sameSceneAsPrevious&&priorScene===segment.sceneIndex){
        if(segment.continuity.inheritEnvironmentReference&&!segment.references.environment&&priorEnvironment)
          segment.references.environment={...priorEnvironment,inherited:true};
        if(segment.continuity.inheritCharacterReferences){
          const present=new Set(segment.references.characters.map(item=>item.character));
          priorCharacters.forEach((ref,name)=>{if(!present.has(name))segment.references.characters.push({...ref,inherited:true});});
        }
      }
      segment.references.characters.forEach(ref=>priorCharacters.set(ref.character,ref));
      if(segment.references.environment)priorEnvironment=segment.references.environment;
      priorScene=segment.sceneIndex;
    });
    return manifest;
  }
  function transition(manifest,segmentId,nextStatus,error=null){
    const segment=findSegment(manifest,segmentId);
    if(!STATUSES.has(nextStatus))throw new Error("Estado de segmento no válido.");
    if(!TRANSITIONS[segment.status]?.includes(nextStatus))throw new Error("Transición no permitida: "+segment.status+" → "+nextStatus+".");
    segment.status=nextStatus;segment.error=error?String(error):null;segment.updatedAt=new Date().toISOString();
    manifest.updatedAt=segment.updatedAt;
    return segment;
  }
  function validateManifest(manifest,options={}){
    const errors=[];
    if(!manifest||!Array.isArray(manifest.segments)||!manifest.segments.length)return {valid:false,errors:["La producción no contiene segmentos."]};
    const segments=[...manifest.segments].sort((a,b)=>a.startSeconds-b.startSeconds);
    let cursor=0;
    segments.forEach((segment,index)=>{
      if(Math.abs(segment.startSeconds-cursor)>0.011)errors.push(segment.id+": existe un hueco o solapamiento en la línea de tiempo.");
      if(!(segment.durationSeconds>0))errors.push(segment.id+": duración inválida.");
      if(![15,30].includes(Number(manifest.maxSegmentSeconds)))errors.push("La producción debe usar segmentos de 15 o 30 segundos.");
      if(Math.abs(segment.durationSeconds-manifest.maxSegmentSeconds)>0.001)errors.push(segment.id+": la duración debe coincidir exactamente con el segmento seleccionado.");
      if(!segment.visualPrompt)errors.push(segment.id+": falta el prompt visual.");
      if(options.requireMedia&&!segment.assets?.video&&!segment.assets?.image)errors.push(segment.id+": falta imagen o video asignado.");
      if(options.requireVideo&&!segment.assets?.video)errors.push(segment.id+": falta un clip de video real; una imagen fija no habilita la exportación.");
      segment.dialogues.forEach(line=>{
        if(!segment.voiceAssignments?.[line.character])errors.push(segment.id+": falta voz para "+line.character+".");
      });
      cursor=segment.endSeconds;
    });
    if(Math.abs(cursor-manifest.targetSeconds)>0.011)errors.push("La duración total no coincide con el objetivo de producción.");
    return {valid:errors.length===0,errors,totalSeconds:cursor,segments:segments.length};
  }
  function buildExportTimeline(manifest){
    const validation=validateManifest(manifest,{requireVideo:true});
    if(!validation.valid)throw new Error("La película todavía no está lista para exportar: "+validation.errors.slice(0,5).join(" "));
    return [...manifest.segments].sort((a,b)=>a.order-b.order).map(segment=>({
      id:segment.id,startSeconds:segment.startSeconds,endSeconds:segment.endSeconds,
      durationSeconds:segment.durationSeconds,video:segment.assets.video||null,
      image:segment.assets.image||null,audio:[...(segment.assets.audio||[])],
      dialogue:segment.dialogues.map(line=>({character:line.character,text:line.text,voice:segment.voiceAssignments[line.character]})),
      references:segment.references
    }));
  }
  async function saveManifest(manifest){
    if(typeof window.VSASupabaseClient!=="function")
      throw new Error("No se pudo conectar con Supabase para guardar la producción en la nube.");
    if(!manifest.projectId)
      throw new Error("La producción debe estar vinculada a un proyecto para guardarse en la nube.");
    const sb=window.VSASupabaseClient();
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError)throw userError;
    if(!user)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    manifest.updatedAt=new Date().toISOString();
    const {error}=await sb.from("production_manifests").upsert({
      id:manifest.id,
      project_id:manifest.projectId,
      user_id:user.id,
      title:manifest.title,
      target_seconds:manifest.targetSeconds,
      total_segments:manifest.totalSegments,
      manifest,
      updated_at:manifest.updatedAt
    },{onConflict:"id"});
    if(error)throw new Error("No se pudo guardar el manifiesto en Supabase: "+error.message);
    return {saved:true,storage:"Supabase"};
  }
  async function loadManifest(id){
    if(typeof window.VSASupabaseClient!=="function")
      throw new Error("No se pudo conectar con Supabase para recuperar la producción.");
    const {data,error}=await window.VSASupabaseClient()
      .from("production_manifests").select("manifest").eq("id",id).maybeSingle();
    if(error)throw new Error("No se pudo recuperar el manifiesto desde Supabase: "+error.message);
    return data?.manifest||null;
  }
  window.VSAProductionEngine={createManifest,addCharacter,updateCharacterProfile,assignAsset,assignVoice,resolveContinuity,transition,validateManifest,buildExportTimeline,saveManifest,loadManifest,VOICES};
})();