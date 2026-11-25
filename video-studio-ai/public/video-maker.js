(() => {
  const $ = (id) => document.getElementById(id);
  const setMessage = (text, error=false) => {
    const el=$("video-message");
    if(el){el.textContent=text;el.style.color=error?"var(--danger, #ffaaa3)":"var(--gold-bright, #f0cf8a)";}
  };

  function chooseRecorderType(){
    const types=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];
    return types.find(type=>window.MediaRecorder?.isTypeSupported(type))||"";
  }

  async function makeAmbientAudio(context, destination){
    const master=context.createGain();
    master.gain.value=0.045;
    master.connect(destination);
    const filter=context.createBiquadFilter();
    filter.type="lowpass";
    filter.frequency.value=850;
    filter.connect(master);
    const oscillators=[];
    [110,164.81,220].forEach((frequency,index)=>{
      const osc=context.createOscillator();
      const gain=context.createGain();
      osc.type=index===1?"triangle":"sine";
      osc.frequency.value=frequency;
      gain.gain.value=index===0?0.45:0.2;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      oscillators.push(osc);
    });
    return ()=>{oscillators.forEach(o=>{try{o.stop();}catch(_){}});master.disconnect();};
  }

  function drawCinematicFrame(ctx, canvas, image, progress){
    const cw=canvas.width,ch=canvas.height;
    const scale=Math.max(cw/image.width,ch/image.height);
    const zoom=1.02+0.10*progress;
    const w=image.width*scale*zoom,h=image.height*scale*zoom;
    const driftX=Math.sin(progress*Math.PI*2)*cw*0.018;
    const driftY=-progress*ch*0.025;
    ctx.fillStyle="#07162c";
    ctx.fillRect(0,0,cw,ch);
    ctx.drawImage(image,(cw-w)/2+driftX,(ch-h)/2+driftY,w,h);
    const shade=ctx.createLinearGradient(0,0,0,ch);
    shade.addColorStop(0,"rgba(3,12,28,0.08)");
    shade.addColorStop(1,"rgba(3,12,28,0.34)");
    ctx.fillStyle=shade;
    ctx.fillRect(0,0,cw,ch);
  }

  async function convertToMp4(webmBlob){
    const {FFmpeg}=await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js");
    const {toBlobURL}=await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js");
    const ffmpeg=new FFmpeg();
    const base="https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    await ffmpeg.load({
      coreURL:await toBlobURL(base+"/ffmpeg-core.js","text/javascript"),
      wasmURL:await toBlobURL(base+"/ffmpeg-core.wasm","application/wasm")
    });
    await ffmpeg.writeFile("input.webm",new Uint8Array(await webmBlob.arrayBuffer()));
    const exitCode=await ffmpeg.exec([
      "-i","input.webm","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p",
      "-c:a","aac","-b:a","128k","-movflags","+faststart","output.mp4"
    ]);
    if(exitCode!==0) throw new Error("No fue posible convertir el clip a MP4 en este navegador.");
    const data=await ffmpeg.readFile("output.mp4");
    return new Blob([data],{type:"video/mp4"});
  }

  async function loadDialogueVoices(context,destination,analysis,duration){
    const scenes=Array.isArray(analysis?.scenes)?analysis.scenes:[];
    const dialogueRows=scenes.flatMap((scene,sceneIndex)=>
      (scene.dialogues||[]).map((dialogue,dialogueIndex)=>({
        sceneIndex,dialogueIndex,sceneDialogueCount:scene.dialogues.length,
        character:dialogue.character,text:String(dialogue.text||"").trim()
      })).filter(item=>item.text)
    );
    if(!dialogueRows.length) return ()=>{};
    const totalCharacters=dialogueRows.reduce((sum,item)=>sum+item.text.length,0);
    if(dialogueRows.length>20||totalCharacters>2000)
      throw new Error("El clip contiene demasiados diálogos para una sola generación gratuita. Reduce el guion a un máximo de 20 intervenciones y 2,000 caracteres para esta prueba.");
    if(typeof window.VSAGetSessionToken!=="function")
      throw new Error("No se pudo validar la sesión para generar las voces.");
    const token=await window.VSAGetSessionToken();
    const buffers=[];
    for(let index=0;index<dialogueRows.length;index++){
      const item=dialogueRows[index];
      const speaker=window.VSAActiveManifest?.characters?.find(character=>character.name===item.character)?.voice||$("video-voice")?.value||"alvaro";
      setMessage("Generando voz en español: "+(index+1)+" de "+dialogueRows.length+"...");
      const response=await fetch("/api/jobs",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":"Bearer "+token},
        body:JSON.stringify({action:"generate_speech",text:item.text,speaker})
      });
      if(!response.ok){
        let detail={};
        try{detail=await response.json();}catch(_){}
        throw new Error(detail.message||(response.status===429
          ?"Se alcanzó la cuota gratuita diaria de voz. No se realizó ningún cargo."
          :"No se pudo generar la voz en español."));
      }
      const bytes=await response.arrayBuffer();
      if(!bytes.byteLength) throw new Error("El motor de voz devolvió un archivo vacío.");
      const decoded=await context.decodeAudioData(bytes.slice(0));
      buffers.push({item,buffer:decoded});
    }
    const sources=[];
    const start=context.currentTime+.45;
    const sceneSpan=duration/Math.max(1,scenes.length);
    buffers.forEach(({item,buffer})=>{
      const source=context.createBufferSource();
      source.buffer=buffer;
      source.connect(destination);
      const offset=(item.dialogueIndex+.5)*sceneSpan/(item.sceneDialogueCount+1);
      source.start(start+item.sceneIndex*sceneSpan+offset);
      sources.push(source);
    });
    return ()=>{
      sources.forEach(source=>{try{source.stop();}catch(_){}try{source.disconnect();}catch(_){}});
    };
  }

  async function createVideo(){
    const button=$("create-video-btn");
    let recorder=null,stream=null,audioContext=null,stopAudio=null,stopVoices=null,raf=0,hasDialogue=false;
    try{
      const duration=Number($("video-duration").value)||30;
      if(duration>30){
        const queueButton=$("wan-queue-submit");
        if(!queueButton)throw new Error("No está disponible la cola Wan 2.2 para películas de más de 30 segundos.");
        setMessage("La duración seleccionada es de más de 30 segundos. Enviando la historia a la cola neuronal Wan 2.2...");
        queueButton.click();
        return;
      }
      const imageElement=$("generation-preview");
      if(!imageElement?.src || $("generation-preview-wrap")?.classList.contains("hidden")){
        throw new Error("Primero genera una imagen con IA. Después podrás convertirla en un clip de 15 o 30 segundos.");
      }
      if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream){
        throw new Error("Este navegador no permite grabar el video. Prueba con la versión más reciente de Chrome o Edge.");
      }
      const includeAudio=$("video-audio").checked;
      button.disabled=true;
      button.textContent="Preparando video...";
      setMessage("Preparando la escena. Mantén esta pestaña abierta hasta terminar.");
      const image=new Image();
      image.src=imageElement.src;
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("No se pudo cargar la imagen generada."));});
      const canvas=document.createElement("canvas");
      canvas.width=1280;canvas.height=720;
      const ctx=canvas.getContext("2d",{alpha:false});
      stream=canvas.captureStream(24);
      if(includeAudio){
        const AudioCtx=window.AudioContext||window.webkitAudioContext;
        if(!AudioCtx) throw new Error("El navegador no permite generar audio. Desactiva la opción de audio e inténtalo de nuevo.");
        audioContext=new AudioCtx();
        await audioContext.resume();
        const destination=audioContext.createMediaStreamDestination();
        const story=$("video-story")?.value.trim()||"";
        const analysis=window.VSASceneEngine?.analyze(story)||{scenes:[],counts:{}};
        hasDialogue=Boolean(analysis.hasDialogue);
        stopAudio=window.VSASceneEngine
          ? window.VSASceneEngine.buildAudio(audioContext,destination,duration,analysis)
          : await makeAmbientAudio(audioContext,destination);
        if(analysis.hasDialogue) stopVoices=await loadDialogueVoices(audioContext,destination,analysis,duration);
        destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
      }
      const mimeType=chooseRecorderType();
      recorder=new MediaRecorder(stream,mimeType?{mimeType,videoBitsPerSecond:4500000}:undefined);
      const chunks=[];
      recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
      const stopped=new Promise((resolve,reject)=>{
        recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||"video/webm"}));
        recorder.onerror=()=>reject(new Error("El navegador encontró un error al grabar el video."));
      });
      const start=performance.now();
      const render=now=>{
        const elapsed=now-start;
        const progress=Math.min(1,elapsed/(duration*1000));
        drawCinematicFrame(ctx,canvas,image,progress);
        setMessage("Creando video: "+Math.min(duration,Math.floor(elapsed/1000))+" de "+duration+" segundos...");
        if(progress<1) raf=requestAnimationFrame(render);
        else if(recorder.state!=="inactive") recorder.stop();
      };
      drawCinematicFrame(ctx,canvas,image,0);
      recorder.start(250);
      raf=requestAnimationFrame(render);
      const webmBlob=await stopped;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach(track=>track.stop());
      if(stopVoices) stopVoices();
      if(stopAudio) stopAudio();
      if(audioContext) await audioContext.close();

      setMessage("Video grabado. Preparando archivo MP4 gratuito en tu navegador...");
      let finalBlob=webmBlob,extension="webm",mime="video/webm";
      try{
        finalBlob=await convertToMp4(webmBlob);
        extension="mp4";mime="video/mp4";
      }catch(conversionError){
        console.warn("Conversión MP4 no disponible; se conserva WebM:",conversionError);
      }
      const url=URL.createObjectURL(finalBlob);
      const preview=$("video-preview");
      const oldUrl=preview.dataset.objectUrl;
      if(oldUrl) URL.revokeObjectURL(oldUrl);
      preview.src=url;preview.dataset.objectUrl=url;
      const link=$("video-download");
      link.href=url;
      link.download="video-studio-ai."+extension;
      link.textContent="Descargar video "+extension.toUpperCase();
      $("video-preview-wrap").classList.remove("hidden");
      window.dispatchEvent(new CustomEvent("vsa-video-created",{detail:{blob:finalBlob,extension,mime}}));
      setMessage(extension==="mp4"
        ?"¡Video MP4 creado! Incluye movimiento de cámara"+(includeAudio?" y ambiente sonoro"+(hasDialogue?" con voces en español.":"."):"." )+" Puedes reproducirlo y descargarlo."
        :"El video se creó correctamente en formato WebM. La conversión gratuita a MP4 no estuvo disponible en este navegador; puedes descargar el WebM.");
    }catch(error){
      cancelAnimationFrame(raf);
      if(recorder&&recorder.state!=="inactive"){try{recorder.stop();}catch(_){}}
      if(stream)stream.getTracks().forEach(track=>track.stop());
      if(stopVoices)stopVoices();
      if(stopAudio)stopAudio();
      if(audioContext){try{await audioContext.close();}catch(_){}}
      setMessage(error.message||"No se pudo crear el video.",true);
    }finally{
      button.disabled=false;
      button.textContent="Crear video gratis";
    }
  }

  const analyzeButton=$("analyze-story-btn");
  if(analyzeButton)analyzeButton.addEventListener("click",()=>{
    const story=$("video-story")?.value.trim()||"";
    const panel=$("scene-analysis");
    if(!story){panel.textContent="Escribe o pega una historia para analizarla.";return;}
    const result=window.VSASceneEngine.analyze(story);
    panel.innerHTML="";
    const heading=document.createElement("p");
    heading.textContent="Escenas detectadas: "+result.total+(result.hasDialogue?" · Se detectaron posibles diálogos.":"");
    panel.append(heading);
    result.scenes.forEach(scene=>{
      const item=document.createElement("div");
      item.style.cssText="padding:10px;margin:8px 0;border:1px solid rgba(140,160,190,.25);border-radius:10px";
      const title=document.createElement("strong");title.textContent=scene.title+" · "+scene.mood;
      const description=document.createElement("p");description.textContent=scene.description;
      const tags=document.createElement("small");tags.textContent=scene.labels.length?scene.labels.join(" · "):"Sin efectos específicos detectados";
      item.append(title,description,tags);panel.append(item);
    });
  });


  const button=$("create-video-btn");
  if(button)button.addEventListener("click",createVideo);
})();
