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
    const dialogueRows=scenes.flatMap(scene=>(scene.dialogues||[]).map(dialogue=>({character:String(dialogue.character||"").trim(),text:String(dialogue.text||"").trim()})).filter(item=>item.text));
    if(!dialogueRows.length)return ()=>{};
    const totalCharacters=dialogueRows.reduce((sum,item)=>sum+Array.from(item.text).length,0);
    if(dialogueRows.length>20||totalCharacters>1200)throw new Error("El diálogo supera el límite de esta prueba 2D (20 intervenciones y 1,200 caracteres). Para películas largas utiliza Wan 2.2, que conserva las voces por personaje.");
    if(typeof window.VSAGetSessionToken!=="function")throw new Error("No se pudo validar la sesión para generar las voces.");
    const token=await window.VSAGetSessionToken(),fallbackVoice=$("video-voice")?.value||"";
    const manifest=window.VSAActiveManifest;
    const characterVoices=new Map((manifest?.characters||[]).map(character=>[String(character.name||"").trim().toLocaleLowerCase(),String(character.voice||"")]));
    const approved=new Set(window.VSAApprovedSpeechifyVoices||[]),prepared=[];
    for(let index=0;index<dialogueRows.length;index++){
      const line=dialogueRows[index],assigned=characterVoices.get(line.character.toLocaleLowerCase())||"";
      const speaker=assigned&&approved.has(assigned)?assigned:fallbackVoice;
      if(!speaker||!approved.has(speaker))throw new Error("El personaje «"+(line.character||"Sin nombre")+"» necesita una voz aprobada. Asigna una voz en el reparto o selecciona una voz general para este clip.");
      setMessage("Speechify · preparando diálogo "+(index+1)+" de "+dialogueRows.length+" · "+line.character+"…");
      const response=await fetch("/api/jobs",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({action:"generate_speech",text:line.text,voice:speaker})});
      if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.message||(response.status===429?"Se alcanzó el límite gratuito de voz. No se realizó ningún cargo.":"Speechify no pudo generar el diálogo "+(index+1)+"."));}
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength<512)throw new Error("Speechify devolvió un audio vacío para "+line.character+".");
      const decoded=await context.decodeAudioData(bytes.slice(0));
      let sumSquares=0,samples=0,peak=0;
      for(let channel=0;channel<decoded.numberOfChannels;channel++){const data=decoded.getChannelData(channel),stride=Math.max(1,Math.floor(data.length/16000));for(let i=0;i<data.length;i+=stride){const sample=Math.abs(data[i]);sumSquares+=sample*sample;samples++;peak=Math.max(peak,sample);}}
      const rms=Math.sqrt(sumSquares/Math.max(1,samples));
      if(decoded.duration<.15||rms<.0005||peak<.002)throw new Error("Speechify devolvió audio silencioso para "+line.character+". Se canceló la exportación.");
      prepared.push({decoded,character:line.character});
      if(index<dialogueRows.length-1)await new Promise(resolve=>setTimeout(resolve,1100));
    }
    const scheduledSeconds=prepared.reduce((sum,item)=>sum+item.decoded.duration+.12,0);
    if(scheduledSeconds>duration)throw new Error("Los diálogos necesitan "+Math.ceil(scheduledSeconds)+" s y el clip solo dura "+duration+" s. Reduce el texto o aumenta la duración.");
    const sources=[];
    let cursor=context.currentTime+1.1;
    try{
      for(const item of prepared){
        const source=context.createBufferSource(),gain=context.createGain(),filter=context.createBiquadFilter(),compressor=context.createDynamicsCompressor();
        source.buffer=item.decoded;
        let sumSquares=0,samples=0,peak=0;
        for(let channel=0;channel<item.decoded.numberOfChannels;channel++){const data=item.decoded.getChannelData(channel),stride=Math.max(1,Math.floor(data.length/16000));for(let i=0;i<data.length;i+=stride){const sample=Math.abs(data[i]);sumSquares+=sample*sample;samples++;peak=Math.max(peak,sample);}}
        const rms=Math.sqrt(sumSquares/Math.max(1,samples));
        gain.gain.value=Math.max(.75,Math.min(8,.24/Math.max(.0001,rms),.92/Math.max(.0001,peak)));
        filter.type="highpass";filter.frequency.value=85;compressor.threshold.value=-20;compressor.knee.value=10;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.2;
        source.connect(gain);gain.connect(filter);filter.connect(compressor);compressor.connect(destination);
        source.start(cursor);sources.push({source,gain,filter,compressor});cursor+=item.decoded.duration+.12;
      }
      return ()=>sources.forEach(({source,gain,filter,compressor})=>{try{source.stop();}catch(_){}try{source.disconnect();gain.disconnect();filter.disconnect();compressor.disconnect();}catch(_){}});
    }catch(error){sources.forEach(({source,gain,filter,compressor})=>{try{source.stop();}catch(_){}try{source.disconnect();gain.disconnect();filter.disconnect();compressor.disconnect();}catch(_){}});throw error;}
  }
  async function createVideo(){
    const button=$("create-video-btn");
    let recorder=null,stream=null,audioContext=null,stopAudio=null,stopVoices=null,raf=0,hasDialogue=false;
    try{
      const duration=Number($("video-duration").value)||30;
      if(duration>30){
        if(typeof window.VSAEnsureFilmReadyAndQueue!=="function")
          throw new Error("El módulo de producción no terminó de cargar. Actualiza la página con Ctrl+F5 e inténtalo de nuevo.");
        setMessage("Preparando la película: creando el plan y generando las imágenes maestras que necesita Wan 2.2…");
        await window.VSAEnsureFilmReadyAndQueue();
        setMessage("Las imágenes maestras están listas. Se ha enviado la película a la cola Wan 2.2; consulta su estado en Motor neuronal · Cola GPU.");
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
        if(!hasDialogue)setMessage("No se detectaron líneas de diálogo. Este clip tendrá música y efectos, pero no voz hablada. Para incluir voces, escribe las intervenciones como: Personaje: texto.");
        if(!window.VSASceneEngine?.buildAudio)
          throw new Error("El motor de sonido no está disponible. Actualiza la página con Ctrl+F5; no se generará un video con zumbido de sustitución.");
        stopAudio=await window.VSASceneEngine.buildAudio(audioContext,destination,duration,analysis);
        if(analysis.hasDialogue) stopVoices=await loadDialogueVoices(audioContext,destination,analysis,duration);
        destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
      }
      const mimeType=chooseRecorderType();
      recorder=new MediaRecorder(stream,mimeType?{mimeType,videoBitsPerSecond:4500000,audioBitsPerSecond:192000}:undefined);
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
