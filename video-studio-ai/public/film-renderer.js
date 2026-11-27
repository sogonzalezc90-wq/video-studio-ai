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
  function cueNoise(ctx,dest,when,duration,volume=.004,frequency=1000){
    const buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.35;
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    source.buffer=buffer;filter.type="lowpass";filter.frequency.value=frequency;
    gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(volume,when+Math.min(.8,duration*.2));
    gain.gain.setValueAtTime(volume,when+duration*.7);gain.gain.linearRampToValueAtTime(.0001,when+duration);
    source.connect(filter);filter.connect(gain);gain.connect(dest);source.start(when);source.stop(when+duration);
  }
  function cueMurmur(ctx,dest,when,duration,volume=.0035){
    [{f:125,formant:520},{f:168,formant:1050},{f:205,formant:1580}].forEach((v,i)=>{
      const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),lfo=ctx.createOscillator(),depth=ctx.createGain();
      osc.type="sawtooth";osc.frequency.value=v.f+(Math.random()*10-5);
      filter.type="bandpass";filter.frequency.value=v.formant;filter.Q.value=1.1;
      gain.gain.value=volume*.4;lfo.frequency.value=.65+i*.21;depth.gain.value=volume*.4;
      lfo.connect(depth);depth.connect(gain.gain);osc.connect(filter);filter.connect(gain);gain.connect(dest);
      osc.start(when);lfo.start(when);osc.stop(when+duration);lfo.stop(when+duration);
    });
  }
  function cueBirds(ctx,dest,when,duration){
    for(let t=.3;t<duration;t+=1.5+Math.random()){
      const at=when+t,osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type="sine";osc.frequency.setValueAtTime(1850+Math.random()*400,at);
      osc.frequency.exponentialRampToValueAtTime(2900+Math.random()*500,at+.13);
      osc.frequency.exponentialRampToValueAtTime(1600,at+.29);
      gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(.008,at+.04);gain.gain.exponentialRampToValueAtTime(.0001,at+.3);
      osc.connect(gain);gain.connect(dest);osc.start(at);osc.stop(at+.31);
    }
  }
  function cueEngine(ctx,dest,when,duration){
    const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    osc.type="sawtooth";osc.frequency.setValueAtTime(62,when);osc.frequency.exponentialRampToValueAtTime(175,when+duration*.55);
    osc.frequency.exponentialRampToValueAtTime(78,when+duration);
    filter.type="lowpass";filter.frequency.value=520;
    gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(.026,when+.45);
    gain.gain.setValueAtTime(.026,when+duration*.55);gain.gain.linearRampToValueAtTime(.0001,when+duration);
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
    const destination=audioCtx.createMediaStreamDestination(),master=audioCtx.createGain(),limiter=audioCtx.createDynamicsCompressor();
    limiter.threshold.value=-22;limiter.knee.value=14;limiter.ratio.value=4.5;limiter.attack.value=.003;limiter.release.value=.2;
    master.gain.value=1.0;master.connect(limiter);limiter.connect(destination);
    const music=audioCtx.createGain();music.gain.value=dialogueBuffers.size?.025:.045;music.connect(master);
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
          voice.buffer=buffer;
          const samples=buffer.getChannelData(0);let energy=0,stride=Math.max(1,Math.floor(samples.length/8000)),count=0;
          for(let n=0;n<samples.length;n+=stride){energy+=samples[n]*samples[n];count++;}
          const rms=Math.sqrt(energy/Math.max(1,count));
          gain.gain.value=Math.min(5.0,Math.max(1.6,.24/Math.max(.001,rms)));
          voice.connect(gain);gain.connect(master);
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
          else if(cue==="ambiente_cafeteria"){cueMurmur(audioCtx,master,segmentStart,duration,.014);for(let k=0;k<2;k++){const at=segmentStart+.7+k*1.8;cueTone(audioCtx,master,at,1480+k*120,.12,.012,"sine");}}
          else if(cue==="trafico_calle"){for(let k=0;k<3;k++)cueEngine(audioCtx,master,segmentStart+k*3,duration*.45);}
          else if(cue==="conversaciones_fondo")cueMurmur(audioCtx,master,segmentStart,duration,.016);
          else if(cue==="tazas_vasos"){for(let k=0;k<3;k++){const at=segmentStart+Math.min(duration-.2,.8+k*1.5);cueTone(audioCtx,master,at,1450+k*170,.12,.012,"sine");cueTone(audioCtx,master,at+.04,2100+k*90,.08,.007,"sine");}}
          else if(cue==="risas"){cueTone(audioCtx,master,segmentStart+1.2,520,.18,.006,"triangle");cueTone(audioCtx,master,segmentStart+1.42,650,.18,.005,"triangle");}
          else if(/^ambiente_(zoologico|consultorio|mercado|plaza_comercial|restaurante|cafeteria|autodromo|calle|biblioteca|escuela|museo|hotel|iglesia|parque|piscina|autobus|construccion|teatro|gimnasio)$/.test(cue)){
            const profile={
              ambiente_zoologico:[4200,.014],ambiente_consultorio:[620,.006],ambiente_mercado:[1700,.014],
              ambiente_plaza_comercial:[2100,.012],ambiente_restaurante:[2400,.010],ambiente_cafeteria:[1500,.010],
              ambiente_autodromo:[950,.014],ambiente_calle:[650,.012],ambiente_biblioteca:[1200,.005],
              ambiente_escuela:[1800,.012],ambiente_museo:[1600,.006],ambiente_hotel:[1400,.009],
              ambiente_iglesia:[1900,.007],ambiente_parque:[2200,.012],ambiente_piscina:[2600,.014],
              ambiente_autobus:[850,.014],ambiente_construccion:[4200,.018],ambiente_teatro:[1200,.009],
              ambiente_gimnasio:[1800,.010]
            }[cue];
            if(cue==="ambiente_zoologico")cueBirds(audioCtx,master,segmentStart,duration);
            else if(["ambiente_mercado","ambiente_plaza_comercial","ambiente_restaurante","ambiente_escuela","ambiente_hotel"].includes(cue))cueMurmur(audioCtx,master,segmentStart,duration,.014);
            else if(cue==="ambiente_autodromo"||cue==="ambiente_autobus")cueEngine(audioCtx,master,segmentStart,duration);
            else if(cue==="ambiente_calle")cueEngine(audioCtx,master,segmentStart,duration*.65);
            else cueNoise(audioCtx,master,segmentStart,duration,Math.min(.004,profile[1]*.3),profile[0]);
          }
          else if(cue==="aves"||cue==="insectos")cueBirds(audioCtx,master,segmentStart,duration);
          else if(cue==="animales"||cue==="perros"||cue==="gatos"||cue==="caballos"){cueTone(audioCtx,master,segmentStart+.5,260,.22,.006,"triangle");}
          else if(cue==="cocina"||cue==="tazas_vasos"){cueNoise(audioCtx,master,segmentStart,duration,.009,2600);}
          else if(cue==="caja_registradora"){cueTone(audioCtx,master,segmentStart+.4,1450,.08,.012,"sine");cueTone(audioCtx,master,segmentStart+.58,1750,.08,.010,"sine");}
          else if(cue==="carritos_compras"){cueNoise(audioCtx,master,segmentStart,duration,.008,3000);}
          else if(cue==="equipo_medico"){cueTone(audioCtx,master,segmentStart+.5,880,.07,.006,"sine");cueTone(audioCtx,master,segmentStart+1.4,880,.07,.006,"sine");}
          else if(cue==="alarma"||cue==="timbre_escolar"||cue==="campanas_iglesia"){cueTone(audioCtx,master,segmentStart,880,.45,.012,"sine");}
          else if(cue==="tren_metro"||cue==="aeropuerto"||cue==="autobus"||cue==="elevador"){cueNoise(audioCtx,master,segmentStart,duration,.014,1000);}
          else if(cue==="construccion"||cue==="gimnasio"){cueNoise(audioCtx,master,segmentStart,duration,.018,4200);}
          else if(cue==="paginas"){cueNoise(audioCtx,master,segmentStart,duration,.006,7200);}
          else if(cue==="agua"||cue==="fuego"){cueNoise(audioCtx,master,segmentStart,duration,.016,2200);}
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