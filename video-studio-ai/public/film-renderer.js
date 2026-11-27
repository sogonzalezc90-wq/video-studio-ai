(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const recorderType=()=>["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(t=>MediaRecorder.isTypeSupported(t))||"";
  function cueTone(ctx,dest,when,freq,duration,volume=.035,wave="sine"){
    if(duration<=0)return;
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type=wave;osc.frequency.setValueAtTime(freq,when);
    gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(volume,when+.04);
    gain.gain.setValueAtTime(volume,when+duration*.7);gain.gain.linearRampToValueAtTime(.0001,when+duration);
    osc.connect(gain);gain.connect(dest);osc.start(when);osc.stop(when+duration+.02);
  }
  function cueMusicPluck(ctx,dest,when,frequency,duration,volume=.025){
    const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    osc.type="triangle";osc.frequency.setValueAtTime(frequency,when);
    filter.type="lowpass";filter.frequency.value=2400;filter.Q.value=.55;
    gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(volume,when+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,when+duration);
    osc.connect(filter);filter.connect(gain);gain.connect(dest);osc.start(when);osc.stop(when+duration+.02);
  }
  async function getDialogueBuffers(manifest,status){
    const lines=manifest.segments.flatMap(segment=>segment.dialogues.map((line,index)=>({segmentId:segment.id,line,index,segment})));
    const total=lines.reduce((n,item)=>n+String(item.line.text||"").length,0);
    if(lines.length>40||total>3500)throw new Error("La película supera el límite gratuito seguro de voz de esta sesión (40 intervenciones o 3,500 caracteres). Divide la producción en partes.");
    if(!lines.length)return new Map();
    let token="";
    try{token=await window.VSAGetSessionToken();}catch(_){
      throw new Error("No se pudo validar la sesión para generar las voces. No se creará una película sin diálogo.");
    }
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const buffers=new Map();
    try{
      status.textContent="Preparando "+lines.length+" voces en español en una sola solicitud gratuita...";
      const dialogues=lines.map(item=>({
        segmentId:String(item.segmentId),index:item.index,
        text:String(item.line.text||"").trim(),
        speaker:item.segment.voiceAssignments?.[item.line.character]||"alvaro"
      }));
      const response=await fetch("/api/jobs",{
        method:"POST",
        headers:{"content-type":"application/json","authorization":"Bearer "+token},
        body:JSON.stringify({action:"generate_speech_batch",dialogues})
      });
      let payload={};
      try{payload=await response.json();}catch(_){}
      if(!response.ok||!payload.ok||!Array.isArray(payload.audio))
        throw new Error(payload.message||(response.status===429
          ?"Se agotó la cuota gratuita diaria de voz. La película se detuvo para no entregar un video sin diálogos."
          :"No se pudieron generar todas las voces en español. La película se detuvo para evitar diálogos ausentes."));
      for(const item of payload.audio){
        if(typeof item.audio!=="string"||!item.audio)throw new Error("El motor de voz devolvió una intervención vacía.");
        const binary=atob(item.audio),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const decoded=await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
        if(decoded.duration<.15)throw new Error("Una intervención de voz quedó vacía o demasiado corta.");
        buffers.set(String(item.segmentId)+":"+item.index,decoded);
      }
      if(buffers.size!==lines.length)throw new Error("El motor de voz no devolvió todas las intervenciones. No se exportará una película incompleta.");
    }finally{await ctx.close();}
    return buffers;
  }
  async function renderFilm(manifest,status){
    if(!window.VSAProductionEngine||!window.VSAMotionEngine)throw new Error("Los motores de producción no están disponibles.");
    const validation=window.VSAProductionEngine.validateManifest(manifest);
    if(!validation.valid)throw new Error("La línea de tiempo no es válida: "+validation.errors.slice(0,4).join(" "));
    const segments=[...manifest.segments].sort((a,b)=>a.order-b.order);
    for(const segment of segments){
      if(!segment.assets?.video?.url&&!segment.assets?.image?.url)throw new Error(segment.id+": asigna un clip de video o una imagen de fondo antes del montaje.");
      const layers=[...(segment.references?.characters||[]),...(segment.references?.props||[])];
      if(layers.some(layer=>!layer.url))throw new Error(segment.id+": hay una capa de personaje/objeto sin URL. Vuelve a seleccionar el recurso.");
    }
    if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream)throw new Error("Este navegador no permite ensamblar video. Usa Chrome o Edge actualizado.");
    status.textContent="Preparando voces y pistas de audio...";
    const dialogueBuffers=await getDialogueBuffers(manifest,status);
    const audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    await audioCtx.resume();
    if(!window.VSANaturalAudio)throw new Error("La biblioteca de ambientes naturales no está disponible. Actualiza la aplicación.");
    const naturalCues=segments.flatMap(segment=>segment.audioCues||[]);
    const natural=await window.VSANaturalAudio.load(audioCtx,naturalCues,message=>{status.textContent=message;});
    const destination=audioCtx.createMediaStreamDestination(),master=audioCtx.createGain(),limiter=audioCtx.createDynamicsCompressor();
    limiter.threshold.value=-10;limiter.knee.value=3;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.18;
    master.gain.value=.88;master.connect(limiter);limiter.connect(destination);
    const music=audioCtx.createGain();music.gain.value=dialogueBuffers.size ? .22 : .42;music.connect(master);
    // Short plucked notes create a changing score without the continuous low drone that resembled hum.
    const score=[220,261.63,329.63,392,349.23,293.66,261.63,329.63];
    const beat=.46,scoreStart=audioCtx.currentTime+.12;
    for(let t=0,n=0;t<manifest.targetSeconds;t+=beat,n++){
      const root=score[n%score.length];
      cueMusicPluck(audioCtx,music,scoreStart+t,root,.34,.065);
      if(n%3===1)cueMusicPluck(audioCtx,music,scoreStart+t+.13,root*2,.22,.014);
    }
    const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;
    const ctx=canvas.getContext("2d",{alpha:false});
    const stream=canvas.captureStream(24);
    destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
    const type=recorderType(),recorder=new MediaRecorder(stream,type?{mimeType:type,videoBitsPerSecond:2200000}:undefined);
    const chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
    const stopped=new Promise((resolve,reject)=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||"video/webm"}));recorder.onerror=()=>reject(new Error("Falló la grabación de la película."));});
    recorder.start(1000);
    let elapsed=0;
    try{
      for(let i=0;i<segments.length;i++){
        const segment=segments[i],duration=Number(segment.durationSeconds);
        status.textContent="Montando segmento "+(i+1)+" de "+segments.length+" · "+segment.id;
        const video=document.createElement("video");
        video.muted=true;video.playsInline=true;video.preload="auto";video.crossOrigin="anonymous";
        let background=null,source=null;
        if(segment.assets.video?.url){
          video.src=segment.assets.video.url;
          await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(new Error("No se pudo abrir el clip "+segment.id+"."));});
          if(video.duration+0.25<duration)throw new Error(segment.id+": el clip dura menos que los "+duration+" segundos requeridos.");
          source=audioCtx.createMediaElementSource(video);
          const clipGain=audioCtx.createGain();clipGain.gain.value=.85;source.connect(clipGain);clipGain.connect(master);
          video.muted=false;
        }else{
          const image=new Image();image.crossOrigin="anonymous";image.src=segment.assets.image.url;
          await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("No se pudo abrir la imagen de "+segment.id+"."));});
          background=image;
        }
        const segmentStart=audioCtx.currentTime+.08;
        (segment.dialogues||[]).forEach((line,index)=>{
          const buffer=dialogueBuffers.get(segment.id+":"+index);if(!buffer)return;
          const voice=audioCtx.createBufferSource(),gain=audioCtx.createGain(),voiceFilter=audioCtx.createBiquadFilter(),voiceCompressor=audioCtx.createDynamicsCompressor();
          voice.buffer=buffer;
          let energy=0,count=0,peak=0;
          for(let channel=0;channel<buffer.numberOfChannels;channel++){
            const samples=buffer.getChannelData(channel),stride=Math.max(1,Math.floor(samples.length/16000));
            for(let n=0;n<samples.length;n+=stride){const sample=Math.abs(samples[n]);energy+=sample*sample;count++;peak=Math.max(peak,sample);}
          }
          const rms=Math.sqrt(energy/Math.max(1,count));
          if(buffer.duration<.15||rms<.0005||peak<.002)throw new Error("Una voz quedó vacía o casi inaudible; se canceló la exportación para no entregar una película sin diálogo.");
          gain.gain.value=Math.min(8,.24/Math.max(.0001,rms),.90/Math.max(.0001,peak));
          voiceFilter.type="highpass";voiceFilter.frequency.value=85;
          voiceCompressor.threshold.value=-18;voiceCompressor.knee.value=8;voiceCompressor.ratio.value=4;
          voiceCompressor.attack.value=.003;voiceCompressor.release.value=.16;
          voice.connect(gain);gain.connect(voiceFilter);voiceFilter.connect(voiceCompressor);voiceCompressor.connect(master);
          const at=Number.isFinite(line.atSeconds)?line.atSeconds:Math.min(duration-.5,.6+(index*duration/Math.max(1,segment.dialogues.length)));
          voice.start(segmentStart+Math.max(0,Math.min(duration-.1,at)));
        });
        const cues=segment.audioCues||[];
        cues.forEach(cue=>{
          if(window.VSANaturalAudio.assetKeys([cue]).length){
            const level=(segment.dialogues||[]).length ? .66 : .88;
            natural.play(master,cue,segmentStart,duration,level);
          }else if(cue==="impacto"){
            cueTone(audioCtx,master,segmentStart,105,.22,.035,"triangle");
          }else if(cue==="tazas_vasos"){
            for(let k=0;k<3;k++){
              const at=segmentStart+Math.min(duration-.2,.8+k*1.5);
              cueTone(audioCtx,master,at,1450+k*170,.12,.012,"sine");
              cueTone(audioCtx,master,at+.04,2100+k*90,.08,.007,"sine");
            }
          }else if(cue==="risas"){
            cueTone(audioCtx,master,segmentStart+1.2,520,.18,.006,"triangle");
            cueTone(audioCtx,master,segmentStart+1.42,650,.18,.005,"triangle");
          }else if(cue==="caja_registradora"){
            cueTone(audioCtx,master,segmentStart+.4,1450,.08,.012,"sine");
            cueTone(audioCtx,master,segmentStart+.58,1750,.08,.010,"sine");
          }else if(cue==="equipo_medico"||cue==="alarma"||cue==="timbre_escolar"||cue==="campanas_iglesia"){
            cueTone(audioCtx,master,segmentStart+.5,880,.45,.012,"sine");
          }
        });

        if(video.src){await video.play();}
        const endAt=performance.now()+duration*1000;
        while(performance.now()<endAt){
          const progress=1-(endAt-performance.now())/(duration*1000);
          if(video.src){
            ctx.fillStyle="#07162c";ctx.fillRect(0,0,canvas.width,canvas.height);
            try{ctx.drawImage(video,0,0,canvas.width,canvas.height);}catch(_){}
          }else{
            await window.VSAMotionEngine.draw(ctx,canvas,segment,progress,background);
          }
          await new Promise(resolve=>requestAnimationFrame(resolve));
          if(Math.floor((elapsed+progress*duration))%5===0)status.textContent="Montaje "+(i+1)+"/"+segments.length+" · "+Math.floor(elapsed+progress*duration)+" / "+manifest.targetSeconds+" segundos";
        }
        if(video.src)video.pause();
        video.removeAttribute("src");video.load();
        elapsed+=duration;
      }
      recorder.stop();
      const blob=await stopped;
      if(!blob.size)throw new Error("El archivo final quedó vacío.");
      const url=URL.createObjectURL(blob);
      const preview=$("video-preview"),link=$("video-download");
      if(preview){preview.src=url;$("video-preview-wrap")?.classList.remove("hidden");}
      if(link){link.href=url;link.download="video-studio-ai-pelicula.webm";link.textContent="Descargar película WebM";}
      window.dispatchEvent(new CustomEvent("vsa-video-created",{detail:{blob,extension:"webm",mime:"video/webm"}}));
      status.textContent="Película ensamblada: "+segments.length+" segmentos · "+Math.floor(manifest.targetSeconds/60)+" min · WebM. Música, ambientes, efectos y voces procesados.";
      return blob;
    }catch(error){
      if(recorder.state!=="inactive"){try{recorder.stop();}catch(_){}}
      throw error;
    }finally{
      stream.getTracks().forEach(track=>track.stop());
      
      await audioCtx.close();
    }
  }
  window.VSAFilmRenderer={renderFilm};
})();