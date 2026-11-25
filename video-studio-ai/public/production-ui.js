(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const shortButton=$("plan-short-btn"),panel=$("segment-workspace");
  const segmentDurationSelect=$("production-segment-duration"),filmDurationSelect=$("production-film-duration"),videoDurationSelect=$("video-duration");
  if(!shortButton||!panel||!window.VSAProductionEngine)return;
  let availableAssets=[];
  const formatTime=seconds=>{const n=Math.floor(seconds),m=Math.floor(n/60),s=n%60;return m+":"+String(s).padStart(2,"0");};
  const addText=(parent,tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;parent.append(node);return node;};
  async function makeReferenceImageBase64(asset,timeRatio=.15){
    if(!asset?.url)return null;
    if(asset.type==="video"){
      const video=document.createElement("video");video.crossOrigin="anonymous";video.muted=true;video.playsInline=true;video.src=asset.url;
      await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error("No se pudo leer el video de referencia "+(asset.name||"del proyecto")));});
      try{const ratio=Math.max(.05,Math.min(.95,Number(timeRatio)||.15));video.currentTime=Math.min(Math.max(0,(video.duration||1)-.08),Math.max(0,(video.duration||1)*ratio));await new Promise(resolve=>{video.onseeked=resolve;setTimeout(resolve,1500);});}catch(_){}
      const canvas=document.createElement("canvas");canvas.width=480;canvas.height=480;
      const ctx=canvas.getContext("2d");const scale=Math.min(480/video.videoWidth,480/video.videoHeight);
      const width=video.videoWidth*scale,height=video.videoHeight*scale;
      ctx.fillStyle="#111827";ctx.fillRect(0,0,480,480);ctx.drawImage(video,(480-width)/2,(480-height)/2,width,height);
      video.pause();video.removeAttribute("src");video.load();
      return canvas.toDataURL("image/jpeg",.84).split(",")[1];
    }
    const image=new Image();image.crossOrigin="anonymous";image.src=asset.url;
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("No se pudo leer la imagen de referencia "+(asset.name||"del proyecto")));});
    const canvas=document.createElement("canvas");canvas.width=480;canvas.height=480;
    const ctx=canvas.getContext("2d");const scale=Math.min(480/image.naturalWidth,480/image.naturalHeight);
    const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
    ctx.fillStyle="#111827";ctx.fillRect(0,0,480,480);ctx.drawImage(image,(480-width)/2,(480-height)/2,width,height);
    return canvas.toDataURL("image/jpeg",.84).split(",")[1];
  }
  async function generateSegmentImages(manifest,button,status){
    if(!manifest.projectId)throw new Error("La producción no está vinculada a un proyecto.");
    if(typeof window.VSASupabaseClient!=="function"||typeof window.VSAGetSessionToken!=="function")
      throw new Error("Inicia sesión para generar y guardar imágenes.");
    const sb=window.VSASupabaseClient();
    const {data:{user},error:userError}=await sb.auth.getUser();
    if(userError)throw userError;
    if(!user)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
    const token=await window.VSAGetSessionToken();
    const pending=manifest.segments.filter(segment=>!segment.assets?.image);
    if(!pending.length){status.textContent="Todos los segmentos ya tienen una imagen asignada.";return;}
    let completed=0;
    button.disabled=true;
    try{
      for(const segment of pending){
        status.textContent="Generando fotograma "+(completed+1)+" de "+pending.length+" · "+segment.id+". Se aplican referencias del proyecto y ficha de personajes.";
        const byId=new Map(availableAssets.map(asset=>[String(asset.id),asset]));
        const assigned=[
          ...(segment.references?.characters||[]),
          ...(segment.references?.environment?[segment.references.environment]:[]),
          ...(segment.references?.props||[])
        ].map(ref=>({...byId.get(String(ref.id)),...ref,type:byId.get(String(ref.id))?.type||"image"}));
        const previousSegment=manifest.segments.find(item=>item.id===segment.references?.previousSegmentId);
        const previousMaster=segment.continuity?.sameSceneAsPrevious&&previousSegment?.assets?.image
          ? [{...byId.get(String(previousSegment.assets.image.id)),...previousSegment.assets.image,type:"image"}] : [];
        const projectRefs=availableAssets.filter(asset=>asset.projectId===manifest.projectId
          && !/^segment-seg-\d{4}-/i.test(asset.name||""));
        const referenceAssets=[...new Map([...assigned,...previousMaster,...projectRefs].filter(asset=>asset?.url).map(asset=>[String(asset.id),asset])).values()].slice(0,4);
        const referenceImages=[],referenceAssetIds=[];
        for(const asset of referenceAssets){
          try{const encoded=await makeReferenceImageBase64(asset,manifest.targetSeconds?segment.startSeconds/manifest.targetSeconds:.15);if(encoded){referenceImages.push(encoded);referenceAssetIds.push(String(asset.id));}}
          catch(referenceError){console.warn("Referencia omitida:",asset.name,referenceError.message);}
        }
        const response=await fetch("/api/jobs",{
          method:"POST",
          headers:{"content-type":"application/json","authorization":"Bearer "+token},
          body:JSON.stringify({
            action:"generate_image",projectId:manifest.projectId,referenceImages,referenceAssetIds,
            prompt:[
              segment.visualPrompt||"",
              "BIBLIA VISUAL OBLIGATORIA DE PERSONAJES:",
              ...(manifest.characters||[]).map(character=>character.name+": "+String(character.description||"Mantener rasgos visibles en las imágenes de referencia.").slice(0,180)),
              "REFERENCIAS MULTIMODALES: utiliza las imágenes adjuntas como referencia real de identidad, vestuario, escenario y objetos. Mantén sus rasgos reconocibles.",
              "ÍNDICE DE REFERENCIAS: "+referenceAssets.map((asset,index)=>"Imagen "+index+" = "+(asset.name||"referencia del proyecto")).join("; "),
              "Si hay una imagen del segmento anterior, conserva los mismos rostros, proporciones, ropa, iluminación y distribución espacial. Cambia únicamente la acción y el encuadre indicados.",
              "Una sola imagen cinematográfica horizontal 16:9. No combinar escenas, no cambiar rostros, peinados, vestuario, proporciones ni objetos."
            ].filter(Boolean).join("\\n").slice(0,3000)
          })
        });
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result.ok)
          throw new Error(result.message||"Se detuvo la generación de fotogramas en "+segment.id+".");
        const binary=atob(result.image);
        const bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const blob=new Blob([bytes],{type:"image/png"});
        const fileName="segment-"+segment.id+"-"+Date.now()+".png";
        const storagePath=user.id+"/"+manifest.projectId+"/"+fileName;
        const {error:uploadError}=await sb.storage.from("video-assets").upload(storagePath,blob,{contentType:"image/png",upsert:false});
        if(uploadError)throw uploadError;
        const {data:record,error:recordError}=await sb.from("project_assets").insert({
          project_id:manifest.projectId,user_id:user.id,storage_path:storagePath,
          file_name:fileName,mime_type:"image/png",asset_type:"image"
        }).select("id").single();
        if(recordError){
          await sb.storage.from("video-assets").remove([storagePath]);
          throw recordError;
        }
        const {data:signed}=await sb.storage.from("video-assets").createSignedUrl(storagePath,3600);
        window.VSAProductionEngine.assignAsset(manifest,segment.id,"image",{
          id:record.id,url:signed?.signedUrl||null,storagePath,name:fileName,type:"image"
        });
        if(segment.status==="planned")window.VSAProductionEngine.transition(manifest,segment.id,"assets_ready");
        try{
          await window.VSAProductionEngine.saveManifest(manifest);
        }catch(saveError){
          await sb.from("project_assets").delete().eq("id",record.id);
          await sb.storage.from("video-assets").remove([storagePath]);
          throw saveError;
        }
        availableAssets.push({id:record.id,projectId:manifest.projectId,url:signed?.signedUrl||null,storagePath,name:fileName,type:"image",mime:"image/png"});
        completed++;
      }
      status.textContent="Fotogramas guardados: "+completed+". Se conservaron en Supabase y quedaron asignados a sus segmentos.";
      window.VSAAvailableAssets=availableAssets;
      window.dispatchEvent(new CustomEvent("vsa-assets-loaded",{detail:{assets:availableAssets}}));
    }catch(error){
      status.textContent="Proceso detenido. Fotogramas guardados en esta sesión: "+completed+" de "+pending.length+". "+error.message+" Puedes continuar después sin repetir los ya guardados.";
      throw error;
    }finally{
      button.disabled=false;
    }
  }
  function hydrateAssetUrls(manifest){
    const byId=new Map(availableAssets.map(asset=>[String(asset.id),asset]));
    manifest.segments.forEach(segment=>{
      [segment.assets?.image,segment.assets?.video,segment.references?.environment,...(segment.references?.characters||[]),...(segment.references?.props||[]),...(segment.assets?.audio||[])].filter(Boolean).forEach(ref=>{
        const fresh=byId.get(String(ref.id));if(fresh?.url)ref.url=fresh.url;
      });
    });
    return manifest;
  }
  function render(manifest){
    hydrateAssetUrls(manifest);
    panel.replaceChildren();
    addText(panel,"p","Producción: "+manifest.title+" · "+manifest.totalSegments+" segmentos · "+formatTime(manifest.targetSeconds)+" · Guardado en Supabase.");
    addText(panel,"p","El manifiesto se guarda en la nube. Puedes asignar clips de video o animar capas PNG transparentes sobre los fondos. La composición por capas genera movimiento 2D; no es generación neuronal de video.","hint");
    const cast=document.createElement("section");cast.className="cast-manager";
    addText(cast,"h4","Personajes de esta historia");
    const addRow=document.createElement("div");addRow.className="cast-add-row";
    const nameInput=document.createElement("input");nameInput.type="text";nameInput.maxLength=80;nameInput.placeholder="Nombre de un personaje nuevo";
    const profileInput=document.createElement("textarea");profileInput.rows=2;profileInput.maxLength=1200;profileInput.placeholder="Rasgos físicos, edad aparente, cabello, complexión, vestuario y accesorios permanentes";
    const addButton=document.createElement("button");addButton.type="button";addButton.className="secondary";addButton.textContent="Agregar personaje";
    addButton.addEventListener("click",async()=>{
      try{window.VSAProductionEngine.addCharacter(manifest,nameInput.value,profileInput.value);await window.VSAProductionEngine.saveManifest(manifest);render(manifest);}
      catch(error){castMessage.textContent=error.message;}
    });
    addRow.append(nameInput,profileInput,addButton);cast.append(addRow);
    const castMessage=addText(cast,"p","","hint");
    const voiceGrid=document.createElement("div");voiceGrid.className="character-voice-grid";
    manifest.characters.forEach(character=>{
      const wrap=document.createElement("label");wrap.textContent=character.name;
      const profile=document.createElement("textarea");profile.rows=3;profile.maxLength=1200;profile.placeholder="Descripción visual permanente del personaje";profile.value=character.description||"";
      profile.addEventListener("change",async()=>{try{window.VSAProductionEngine.updateCharacterProfile(manifest,character.name,profile.value);await window.VSAProductionEngine.saveManifest(manifest);castMessage.textContent="Apariencia y vestuario guardados para "+character.name+"."; }catch(error){castMessage.textContent=error.message;}});
      const select=document.createElement("select");
      window.VSAProductionEngine.VOICES.forEach(voice=>{const option=document.createElement("option");option.value=voice;option.textContent=voice.charAt(0).toUpperCase()+voice.slice(1);option.selected=voice===character.voice;select.append(option);});
      select.addEventListener("change",async()=>{try{window.VSAProductionEngine.assignVoice(manifest,character.name,select.value);await window.VSAProductionEngine.saveManifest(manifest);castMessage.textContent="Voz guardada para "+character.name+"."; }catch(error){castMessage.textContent=error.message;}});
      wrap.append(profile,select);voiceGrid.append(wrap);
    });
    cast.append(voiceGrid);panel.append(cast);
    const validation=window.VSAProductionEngine.validateManifest(manifest);
    addText(panel,"p",validation.valid?"Línea de tiempo validada: "+validation.segments+" segmentos, sin huecos ni solapamientos.":"Revisión pendiente: "+validation.errors.slice(0,2).join(" "),"hint");
    const generationRow=document.createElement("div");
    generationRow.className="segment-generation-controls";
    const generateImagesButton=document.createElement("button");
    generateImagesButton.type="button";
    generateImagesButton.className="primary";
    generateImagesButton.textContent="Generar fotogramas de segmentos pendientes";
    const generationStatus=addText(generationRow,"p","Genera una imagen maestra por segmento con hasta cuatro referencias reales del proyecto (personajes, imágenes o fotogramas de video). Se guarda en Supabase antes de animarla con Wan 2.2.","hint");
    generateImagesButton.addEventListener("click",async()=>{
      try{await generateSegmentImages(manifest,generateImagesButton,generationStatus);render(manifest);}
      catch(error){generationStatus.textContent=error.message;}
    });
    generationRow.append(generateImagesButton);
    panel.append(generationRow);
    const neuralRow=document.createElement("div");neuralRow.className="segment-generation-controls";
    const neuralButton=document.createElement("button");neuralButton.type="button";neuralButton.className="primary";neuralButton.textContent="Generar película con movimiento real · Wan 2.2";
    const neuralStatus=addText(neuralRow,"p","Envía la historia a Kaggle GPU. Wan 2.2 genera movimiento de video; el trabajo requiere que el notebook esté activo. La duración debe coincidir con la película seleccionada.","hint");
    neuralButton.addEventListener("click",()=>{
      const queueButton=$("wan-queue-submit");
      if(!queueButton){neuralStatus.textContent="No está disponible el envío a la cola Wan 2.2.";return;}
      if(Number(videoDurationSelect?.value)!==Number(manifest.targetSeconds)){
        neuralStatus.textContent="La duración del selector principal no coincide con el manifiesto. Vuelve a preparar el plan con la duración correcta.";return;
      }
      neuralStatus.textContent="Enviando la película a la cola Wan 2.2...";
      queueButton.click();
    });
    neuralRow.append(neuralButton);panel.append(neuralRow);
    const exportRow=document.createElement("div");exportRow.className="segment-generation-controls";
    const exportButton=document.createElement("button");exportButton.type="button";exportButton.className="secondary";exportButton.textContent="Montar fotogramas · movimiento de cámara 2D";
    const hasNeuralClips=manifest.segments.some(segment=>Boolean(segment.assets?.video?.url));
    const exportStatus=addText(exportRow,"p",hasNeuralClips
      ?"Monta los clips de video asignados, conserva su movimiento y mezcla voces, música y ambientes."
      :"Este montaje usa imágenes fijas con desplazamiento y zoom de cámara. No anima cuerpos, rostros ni vehículos; para movimiento real usa el botón Wan 2.2 de arriba.","hint");
    exportButton.addEventListener("click",async()=>{
      exportButton.disabled=true;
      try{await window.VSAFilmRenderer.renderFilm(manifest,exportStatus);}
      catch(error){exportStatus.textContent="No se pudo montar la película: "+error.message;}
      finally{exportButton.disabled=false;}
    });
    exportRow.append(exportButton);panel.append(exportRow);
    const list=document.createElement("div");list.className="segment-list";
    manifest.segments.forEach(segment=>{
      const card=document.createElement("article");card.className="segment-card";
      addText(card,"strong",segment.id+" · "+formatTime(segment.startSeconds)+"–"+formatTime(segment.endSeconds)+" · "+segment.durationSeconds+" s");
      addText(card,"p","Escena "+segment.sceneNumber+" / Toma "+segment.shotNumber+" · "+segment.shotTitle);
      addText(card,"small","Estado: "+segment.status+" · "+(segment.dialogues.length?segment.dialogues.length+" diálogo(s)":"Sin diálogo detectado"));
      if(segment.dialogues.length)addText(card,"p",segment.dialogues.map(line=>line.character+": "+line.text).join(" | "));
      const projectAssets=availableAssets.filter(asset=>!manifest.projectId||asset.projectId===manifest.projectId);
      const references=document.createElement("div");references.className="segment-references";
      const makeAssetSelect=(label,role,character)=>{
        const wrap=document.createElement("label");wrap.textContent=label;
        const select=document.createElement("select");
        const empty=document.createElement("option");empty.value="";empty.textContent="Selecciona un recurso de la biblioteca";select.append(empty);
        projectAssets.filter(asset=>asset.type===(role==="video"?"video":"image")).forEach(asset=>{const option=document.createElement("option");option.value=asset.id;option.textContent=asset.name;select.append(option);});
        const existing=role==="image"?segment.assets.image:role==="video"?segment.assets.video:role==="environment"?segment.references.environment:role==="prop"?segment.references.props[0]:segment.references.characters.find(item=>item.character===character);
        if(existing)select.value=existing.id;
        select.addEventListener("change",async()=>{try{if(!select.value)return;const asset=projectAssets.find(item=>item.id===select.value);window.VSAProductionEngine.assignAsset(manifest,segment.id,role,{...asset,character});if(role==="image"&&segment.status==="planned")window.VSAProductionEngine.transition(manifest,segment.id,"assets_ready");window.VSAProductionEngine.resolveContinuity(manifest);await window.VSAProductionEngine.saveManifest(manifest);render(manifest);}catch(error){castMessage.textContent=error.message;}});
        wrap.append(select);references.append(wrap);
      };
      makeAssetSelect("Imagen de fondo de esta toma","image");
      makeAssetSelect("Clip de video (opcional)","video");
      makeAssetSelect("Escenario / locación","environment");
      manifest.characters.forEach(character=>makeAssetSelect("Capa PNG transparente de "+character.name,"character",character.name));
      makeAssetSelect("Capa PNG transparente de vehículo / objeto","prop");
      if(!projectAssets.length)addText(references,"small","No hay recursos disponibles en la biblioteca de este proyecto.","hint");
      addText(references,"small","Para animar personajes u objetos sobre un fondo, asigna PNG con transparencia. El compositor aplica desplazamiento y movimiento 2D a esas capas.","hint");
      card.append(references);
      const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent="Ver prompt visual y continuidad";details.append(summary);
      const prompt=document.createElement("textarea");prompt.readOnly=true;prompt.rows=4;prompt.value=segment.visualPrompt;details.append(prompt);
      addText(details,"small",segment.continuity.sameSceneAsPrevious?"Hereda referencias de la toma anterior de esta escena.":"Inicio de escena: define sus referencias visuales.");
      card.append(details);list.append(card);
    });
    panel.append(list);
  }
  async function restoreLatestManifest(projectId){
    if(!projectId||typeof window.VSASupabaseClient!=="function")return;
    try{
      const {data,error}=await window.VSASupabaseClient()
        .from("production_manifests")
        .select("manifest")
        .eq("project_id",projectId)
        .order("updated_at",{ascending:false})
        .limit(1)
        .maybeSingle();
      if(error)throw error;
      if(data?.manifest){
        window.VSAActiveManifest=hydrateAssetUrls(data.manifest);
        render(data.manifest);
      }else{
        window.VSAActiveManifest=null;
        panel.replaceChildren();
        addText(panel,"p","Este proyecto todavía no tiene una producción guardada en la nube.","hint");
      }
    }catch(error){
      addText(panel,"p","No se pudo recuperar la producción guardada: "+error.message,"hint");
    }
  }
  const projectSelect=$("generation-project");
  if(projectSelect)projectSelect.addEventListener("change",()=>restoreLatestManifest(projectSelect.value));
  async function prepareManifest(durationSeconds,modeLabel){
    try{
      const story=$("video-story")?.value.trim()||"";
      if(!story)throw new Error("Primero escribe la historia.");
      const project=$("generation-project");
      if(!project?.value)throw new Error("Selecciona primero el proyecto destino.");
      const analysis=window.VSASceneEngine.analyze(story);
      const projectName=project.selectedOptions?.[0]?.textContent||"Producción";
      const segmentSeconds=Number(segmentDurationSelect?.value)===30?30:15;
      const manifest=window.VSAProductionEngine.createManifest(analysis,{
        durationSeconds,maxSegmentSeconds:segmentSeconds,projectId:project.value,
        title:projectName+" · "+modeLabel
      });
      if(!manifest.totalSegments)throw new Error("No se detectaron escenas para construir segmentos.");
      window.VSAProductionEngine.resolveContinuity(manifest);
      await window.VSAProductionEngine.saveManifest(manifest);
      window.VSAActiveManifest=manifest;
      render(manifest);
    }catch(error){panel.textContent="No se pudo preparar el manifiesto: "+error.message;}
  }
  function syncFilmDurations(){
    if(!segmentDurationSelect||!filmDurationSelect)return;
    const segment=Number(segmentDurationSelect.value)||15;
    [...filmDurationSelect.options].forEach(option=>{option.disabled=Number(option.value)%segment!==0;});
    if(filmDurationSelect.selectedOptions[0]?.disabled){
      const firstAvailable=[...filmDurationSelect.options].find(option=>!option.disabled);
      if(firstAvailable)filmDurationSelect.value=firstAvailable.value;
    }
    if(videoDurationSelect)videoDurationSelect.value=filmDurationSelect.value;
  }
  function syncVideoFromFilm(){
    if(!filmDurationSelect||!videoDurationSelect)return;
    const duration=Number(videoDurationSelect.value);
    if(duration===15&&Number(segmentDurationSelect?.value)===30)segmentDurationSelect.value="15";
    filmDurationSelect.value=String(duration);
    syncFilmDurations();
  }
  function syncFilmFromVideo(){
    if(!filmDurationSelect||!videoDurationSelect)return;
    const duration=Number(filmDurationSelect.value);
    if(duration===15&&Number(segmentDurationSelect?.value)===30)segmentDurationSelect.value="15";
    videoDurationSelect.value=String(duration);
    syncFilmDurations();
  }
  segmentDurationSelect?.addEventListener("change",syncFilmDurations);
  filmDurationSelect?.addEventListener("change",syncFilmFromVideo);
  videoDurationSelect?.addEventListener("change",syncVideoFromFilm);
  syncFilmDurations();
  shortButton.addEventListener("click",()=>{
    const duration=Number(filmDurationSelect?.value)||1200;
    prepareManifest(duration,"Película · "+formatTime(duration)+" · segmentos de "+(Number(segmentDurationSelect?.value)||15)+" segundos");
  });
  window.addEventListener("vsa-assets-loaded",event=>{availableAssets=Array.isArray(event.detail?.assets)?event.detail.assets:[];if(window.VSAActiveManifest)render(window.VSAActiveManifest);});
  window.addEventListener("vsa-production-updated",event=>{if(event.detail?.manifest)window.VSAActiveManifest=hydrateAssetUrls(event.detail.manifest);});
})();