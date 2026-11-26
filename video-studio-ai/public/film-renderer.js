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
  function cueNoise(ctx,dest,when,duration,volume=.02,frequency=1000){
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=buffer;filter.type="lowpass";filter.frequency.value=frequency;
    gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(volume,when+.08);
    gain.gain.setValueAtTime(volume,when+duration*.7);gain.gain.linearRampToValueAtTime(.0001,when+duration);
    source.connect(filter);filter.connect(gain);gain.connect(dest);source.start(when);source.stop(when+duration);
  }
  async function getDialogueBuffers(manifest,status){
    const lines=manifest.segments.flatMap(segment=>segment.dialogues.map((line,index)=>({segmentId:segment.id,line,index})));
    const total=lines.reduce((n,item)=>n+String(item.line.text||"").length,0);
    if(lines.length>160||total>12000)throw new Error("La película supera el límite de seguridad de voz de esta sesión (160 intervenciones o 12,000 caracteres). Divide la producción en partes.");
    if(!lines.length)return new Map();
    const buffers=new Map();
    let token="";
    try{token=await window.VSAGetSessionToken();}catch(_){
      status.textContent="La sesión de voz no está disponible; la película continuará con música y ambientes.";
      return buffers;
    }
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    try{
      for(let i=0;i<lines.length;i++){
        const item=lines[i],segment=manifest.segments.find(s=>s.id===item.segmentId);
        status.textContent="Preparando diálogo "+(i+1)+" de "+lines.length+"...";
        const speaker=segment.voiceAssignments?.[item.line.character]||"alvaro";
        try{
          const response=await fetch("/api/jobs",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+token},
            body:JSON.stringify({action:"generate_speech",text:String(item.line.text).slice(0,1200),speaker})});
          if(!response.ok){
            status.textContent=response.status===429
              ?"Se agotó la cuota gratuita de voz; la película continuará con música y ambientes."
              :"No se pudo generar la voz de "+item.line.character+"; se conservará la banda sonora.";
            if(response.status===429)break;
            continue;
          }
          const bytes=await response.arrayBuffer();
          if(!bytes.byteLength)continue;
          buffers.set(item.segmentId+":"+item.index,await ctx.decodeAudioData(bytes.slice(0)));
        }catch(voiceError){
          status.textContent="Una voz no estuvo disponible; el montaje continuará con música y efectos.";
        }
      }
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
    const destination=audioCtx.createMediaStreamDestination(),master=audioCtx.createGain();
    master.gain.value=1;master.connect(destination);
    const music=audioCtx.createGain();music.gain.value=.12;music.connect(master);
    // A small harmonic bed is deliberately audible in the exported file.
    const musicOscillators=[];
    [110,164.81,220,261.63].forEach((frequency,index)=>{
      const oscillator=audioCtx.createOscillator(),toneGain=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();
      oscillator.type=index===0?"triangle":"sine";oscillator.frequency.setValueAtTime(frequency,audioCtx.currentTime);
      toneGain.gain.value=[.22,.14,.10,.07][index];filter.type="lowpass";filter.frequency.value=1800;
      oscillator.connect(toneGain);toneGain.connect(filter);filter.connect(music);oscillator.start();
      musicOscillators.push(oscillator);
    });
    // Gentle chord changes prevent the music bed from being a single static note.
    const chordProgression=[[110,164.81,220,261.63],[98,146.83,196,246.94],[130.81,164.81,196,261.63],[87.31,130.81,174.61,220]];
    for(let bar=0;bar<Math.ceil(manifest.targetSeconds/8);bar++){
      const chord=chordProgression[bar%chordProgression.length],at=audioCtx.currentTime+bar*8;
      musicOscillators.forEach((osc,index)=>osc.frequency.setValueAtTime(chord[index],at));
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
          const voice=audioCtx.createBufferSource(),gain=audioCtx.createGain();
          voice.buffer=buffer;gain.gain.value=1;voice.connect(gain);gain.connect(master);
          const at=Number.isFinite(line.atSeconds)?line.atSeconds:Math.min(duration-.5,.6+(index*duration/Math.max(1,segment.dialogues.length)));
          voice.start(segmentStart+Math.max(0,Math.min(duration-.1,at)));
        });
        const cues=segment.audioCues||[];
        cues.forEach(cue=>{
          if(cue==="lluvia")cueNoise(audioCtx,master,segmentStart,duration,.012,1800);
          else if(cue==="viento_ambiente")cueNoise(audioCtx,master,segmentStart,duration,.022,520);
          else if(cue==="motor_automovil"||cue==="motor_motocicleta"){cueTone(audioCtx,master,segmentStart,65,duration*.8,.045,"sawtooth");cueTone(audioCtx,master,segmentStart+1,125,duration*.7,.026,"sawtooth");}
          else if(cue==="pasos")for(let k=0;k<Math.min(12,Math.floor(duration*1.2));k++)cueTone(audioCtx,master,segmentStart+k*.75,72,.09,.018,"triangle");
          else if(cue==="puerta")cueTone(audioCtx,master,segmentStart+Math.min(1,duration*.2),180,.35,.04,"triangle");
          else if(cue==="impacto")cueNoise(audioCtx,master,segmentStart,.45,.04,500);
          else if(cue==="herramientas_taller")cueNoise(audioCtx,master,segmentStart,duration*.5,.024,3200);
          else if(cue==="ambiente_cafeteria"){cueNoise(audioCtx,master,segmentStart,duration,.010,1500);cueNoise(audioCtx,master,segmentStart,duration,.006,520);}
          else if(cue==="trafico_calle")cueNoise(audioCtx,master,segmentStart,duration,.012,620);
          else if(cue==="conversaciones_fondo")cueNoise(audioCtx,master,segmentStart,duration,.008,2100);
          else if(cue==="tazas_vasos"){for(let k=0;k<3;k++){const at=segmentStart+Math.min(duration-.2,.8+k*1.5);cueTone(audioCtx,master,at,1450+k*170,.12,.018,"sine");cueTone(audioCtx,master,at+.04,2100+k*90,.08,.012,"sine");}}
          else if(cue==="risas"){for(let k=0;k<2;k++){const at=segmentStart+Math.min(duration-.25,1.2+k*2.1);cueTone(audioCtx,master,at,520,.13,.009,"triangle");cueTone(audioCtx,master,at+.16,620,.12,.008,"triangle");}}
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
      status.textContent="Película ensamblada: "+segments.length+" segmentos · "+Math.floor(manifest.targetSeconds/60)+" min · WebM. Audio y voces incluidos.";
      return blob;
    }catch(error){
      if(recorder.state!=="inactive"){try{recorder.stop();}catch(_){}}
      throw error;
    }finally{
      stream.getTracks().forEach(track=>track.stop());
      musicOscillators.forEach(osc=>{try{osc.stop();}catch(_){}});
      await audioCtx.close();
    }
  }
  window.VSAFilmRenderer={renderFilm};
})();